#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path


MONTHS = {
    "январь": 1,
    "января": 1,
    "февраль": 2,
    "февраля": 2,
    "март": 3,
    "марта": 3,
    "апрель": 4,
    "апреля": 4,
    "май": 5,
    "мая": 5,
    "июнь": 6,
    "июня": 6,
    "июль": 7,
    "июля": 7,
    "август": 8,
    "августа": 8,
    "сентябрь": 9,
    "сентября": 9,
    "октябрь": 10,
    "октября": 10,
    "ноябрь": 11,
    "ноября": 11,
    "декабрь": 12,
    "декабря": 12,
}

DATE_HEADER_RE = re.compile(r"(?m)^###\s+(.+?)\s*$")
TRAILING_SEPARATOR_RE = re.compile(r"\n*\s*---\s*$")


@dataclass
class DateBlock:
    label: str
    body: str
    original_index: int


def normalize_label(label: str) -> str:
    """Нормализует пробелы и разновидности тире для сравнения дат."""
    label = label.strip().lower()
    label = re.sub(r"[–—−]", "-", label)
    label = re.sub(r"\s+", " ", label)
    label = re.sub(r"\s*-\s*", "-", label)
    return label


def parse_date_key(label: str) -> tuple[int, int, int, int]:
    """
    Возвращает ключ:
        (год, месяц, день, тип_точности)

    Поддерживает:
        23 января 1991 года
        19–21 августа 1991 года
        28 октября — 2 ноября 1991 года
        июнь 1991 года
        Ночь с 4 на 5 июня 1993 года
        Ночь с 26 на 27 февраля (11 на 12 марта) 1917 года
        Ночь с 6 (19) на 7 (20) января 1918 года
        Ночь с 31 января на 14 февраля 1918 года
        1943 год
        1943 год (итог)
        1965–1973 годы

    Неопределённый день месяца помещается после точных дат этого месяца.
    Неопределённые месяц и день (формат «только год» и «диапазон лет»)
    помещаются после всех датированных событий этого года.
    Ночные даты сортируются по начальной дате ночи.
    """
    value = normalize_label(label)

    # 28 октября - 2 ноября 1991 года
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+)-(\d{1,2}) ([а-яё]+) (\d{4}) года",
        value,
    )
    if match:
        day, month_name, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # 19-21 августа 1991 года
    match = re.fullmatch(
        r"(\d{1,2})-(\d{1,2}) ([а-яё]+) (\d{4}) года",
        value,
    )
    if match:
        start_day, _, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(start_day), 0

    # 23 января 1991 года
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+) (\d{4}) года",
        value,
    )
    if match:
        day, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # Ночь с 4 на 5 июня 1993 года,
    # Ночь с 26 на 27 февраля (11 на 12 марта) 1917 года
    # Начальная дата ночи — первый указанный день, месяц — из первого месяца.
    match = re.fullmatch(
        r"ночь с (\d{1,2}) на (\d{1,2}) ([а-яё]+)(?: \((\d{1,2}) на (\d{1,2}) ([а-яё]+)\))? (\d{4}) года",
        value,
    )
    if match:
        day, _, month_name, _, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # Ночь с 6 (19) на 7 (20) января 1918 года,
    # Ночь с 11 (23) на 12 (24) марта 1801 года
    match = re.fullmatch(
        r"ночь с (\d{1,2}) \((\d{1,2})\) на (\d{1,2}) \((\d{1,2})\) ([а-яё]+) (\d{4}) года",
        value,
    )
    if match:
        day, _, _, _, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # Ночь с 31 января на 14 февраля 1918 года
    match = re.fullmatch(
        r"ночь с (\d{1,2}) ([а-яё]+) на (\d{1,2}) ([а-яё]+) (\d{4}) года",
        value,
    )
    if match:
        day, month_name, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # июнь 1991 года
    match = re.fullmatch(r"([а-яё]+) (\d{4}) года", value)
    if match:
        month_name, year = match.groups()

        # День 32 означает: после всех точных дат этого месяца.
        return int(year), MONTHS[month_name], 32, 1

    # 1943 год, 1943 год (итог)
    match = re.fullmatch(r"(\d{4}) год(?:\s*\(.+\))?", value)
    if match:
        # Месяц 13 означает: после всех датированных событий этого года.
        return int(match.group(1)), 13, 0, 2

    # 1965-1973 годы
    match = re.fullmatch(r"(\d{4})-(\d{4}) годы", value)
    if match:
        return int(match.group(1)), 13, 0, 1

    raise ValueError(f"Не удалось распознать дату: {label!r}")


def split_document(text: str) -> tuple[str, list[DateBlock]]:
    matches = list(DATE_HEADER_RE.finditer(text))

    if not matches:
        return text.strip(), []

    preamble = text[:matches[0].start()].strip()
    blocks: list[DateBlock] = []

    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)

        body = text[start:end].strip()
        body = TRAILING_SEPARATOR_RE.sub("", body).strip()

        blocks.append(
            DateBlock(
                label=match.group(1).strip(),
                body=body,
                original_index=index,
            )
        )

    return preamble, blocks


def add_event(
    blocks: list[DateBlock],
    date_label: str,
    event: str,
) -> None:
    normalized_target = normalize_label(date_label)
    matching_blocks = [
        block
        for block in blocks
        if normalize_label(block.label) == normalized_target
    ]

    if matching_blocks:
        if not event.lstrip().startswith("#### "):
            raise ValueError(
                "Дата уже существует. Новое событие должно начинаться "
                "с подзаголовка вида '#### Название события'."
            )

        target = matching_blocks[0]
        target.body = f"{target.body.rstrip()}\n\n{event.strip()}"
        return

    blocks.append(
        DateBlock(
            label=date_label.strip(),
            body=event.strip(),
            original_index=len(blocks),
        )
    )


def render_document(
    preamble: str,
    blocks: list[DateBlock],
) -> str:
    sorted_blocks = sorted(
        blocks,
        key=lambda block: (
            parse_date_key(block.label),
            block.original_index,
        ),
    )

    rendered_blocks = [
        f"### {block.label}\n\n{block.body.strip()}"
        for block in sorted_blocks
    ]

    parts: list[str] = []

    if preamble:
        parts.append(preamble)

    parts.extend(rendered_blocks)

    return "\n\n---\n\n".join(parts).rstrip() + "\n"


def atomic_write(path: Path, content: str) -> None:
    backup_path = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, backup_path)

    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=path.parent,
        delete=False,
    ) as temporary_file:
        temporary_file.write(content)
        temporary_path = Path(temporary_file.name)

    temporary_path.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Добавление события в хронологический Markdown-файл."
    )
    parser.add_argument("timeline", type=Path)
    parser.add_argument("--date", required=True)
    parser.add_argument("--event", required=True, type=Path)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Вывести результат, не изменяя файл.",
    )

    args = parser.parse_args()

    original_text = args.timeline.read_text(encoding="utf-8")
    event_text = args.event.read_text(encoding="utf-8")

    preamble, blocks = split_document(original_text)
    add_event(blocks, args.date, event_text)

    result = render_document(preamble, blocks)

    if args.dry_run:
        print(result)
    else:
        atomic_write(args.timeline, result)
        print(f"Событие добавлено: {args.date}")
        print(f"Резервная копия: {args.timeline}.bak")


if __name__ == "__main__":
    main()
