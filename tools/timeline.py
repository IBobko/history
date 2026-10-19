#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import shutil
import tempfile
from dataclasses import dataclass
from datetime import date, timedelta
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

MONTH_NAMES = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)
RUSSIA_GREGORIAN_CALENDAR_START = date(1918, 2, 14)

DATE_HEADER_RE = re.compile(r"(?m)^###\s+(.+?)\s*$")
TRAILING_SEPARATOR_RE = re.compile(r"\n*\s*---\s*$")


@dataclass
class DateBlock:
    label: str
    body: str
    original_index: int


@dataclass(frozen=True)
class NumericDate:
    """Дата для заголовка и дата, определяющая год файла и сортировку."""

    label: str
    primary_date: date


def normalize_label(label: str) -> str:
    """Нормализует пробелы и разновидности тире для сравнения дат."""
    label = label.strip().lower()
    label = re.sub(r"[–—−]", "-", label)
    label = re.sub(r"\s+", " ", label)
    label = re.sub(r"\s*-\s*", "-", label)
    return label


def julian_to_gregorian(value: date) -> date:
    """Переводит дату юлианского календаря в пролептический григорианский."""
    difference = value.year // 100 - value.year // 400 - 2
    if value.month < 3 and value.year % 100 == 0 and value.year % 400 != 0:
        difference -= 1
    return value + timedelta(days=difference)


def gregorian_to_julian(value: date) -> date:
    """Переводит дату пролептического григорианского календаря в юлианский."""
    for difference in range(10, 15):
        candidate = value - timedelta(days=difference)
        if julian_to_gregorian(candidate) == value:
            return candidate
    raise ValueError(f"Не удалось перевести дату в старый стиль: {value}")


def format_russian_date(value: date) -> str:
    return f"{value.day} {MONTH_NAMES[value.month - 1]} {value.year} года"


def format_dual_date(old_style: date, new_style: date) -> str:
    """Форматирует дату по принятому в проекте порядку: старый стиль, затем новый."""
    old_month = MONTH_NAMES[old_style.month - 1]
    new_month = MONTH_NAMES[new_style.month - 1]

    if old_style.year != new_style.year:
        return (
            f"{old_style.day} {old_month} {old_style.year} "
            f"({new_style.day} {new_month} {new_style.year}) года"
        )
    if old_style.month != new_style.month:
        return (
            f"{old_style.day} {old_month} "
            f"({new_style.day} {new_month}) {old_style.year} года"
        )
    return f"{old_style.day} ({new_style.day}) {old_month} {old_style.year} года"


def numeric_date_label(
    value: date,
    calendar: str,
    is_russia: bool,
) -> NumericDate:
    """Строит заголовок для точной ISO-даты и выбирает её первичный стиль."""
    if calendar == "old":
        old_style = value
        new_style = julian_to_gregorian(value)
        return NumericDate(format_dual_date(old_style, new_style), old_style)

    new_style = value
    if is_russia and new_style < RUSSIA_GREGORIAN_CALENDAR_START:
        old_style = gregorian_to_julian(new_style)
        return NumericDate(format_dual_date(old_style, new_style), old_style)

    return NumericDate(format_russian_date(new_style), new_style)


def is_russia_target(target: Path) -> bool:
    directory = target.parent if target.suffix.lower() == ".md" else target
    return directory.name.lower() == "russia"


def resolve_timeline_path(target: Path, year: int) -> Path:
    """Принимает конкретный файл или папку категории для автоматического выбора года."""
    if target.suffix.lower() == ".md":
        return target
    return target / f"{year}.md"


def parse_date_key(label: str) -> tuple[int, int, int, int]:
    """
    Возвращает ключ:
        (год, месяц, день, тип_точности)

    Поддерживает:
        23 января 1991 года
        19–21 августа 1991 года
        28 октября — 2 ноября 1991 года
        15 ноября 1884 года — 26 февраля 1885 года
        17 ноября 1991 года — 31 марта 1995 года
        5 (17) сентября 1809 года
        30 апреля (13 мая) 1918 года
        28 декабря 1809 (9 января 1810) года
        июнь 1991 года
        апрель — 16 ноября 1920 года
        июнь — июль 1917 года
        Ночь с 4 на 5 июня 1993 года
        Ночь с 26 на 27 февраля (11 на 12 марта) 1917 года
        Ночь с 6 (19) на 7 (20) января 1918 года
        Ночь с 31 января на 14 февраля 1918 года
        1943 год
        1943 год (итог)
        1965–1973 годы

    Неопределённый день месяца помещается после точных дат этого месяца.
    Период, начинающийся в конкретный день, ставится после события
    этого дня и перед следующим днём.
    Неопределённые месяц и день (формат «только год» и «диапазон лет»)
    помещаются после всех датированных событий этого года.
    Ночные даты сортируются по начальной дате ночи.
    """
    value = normalize_label(label)

    # 15 ноября 1884 года - 26 февраля 1885 года
    # 17 ноября 1991 года - 31 марта 1995 года
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+) (\d{1,4}) года-(\d{1,2}) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        day, month_name, year, _, _, _ = match.groups()
        return int(year), MONTHS[month_name], int(day), 1

    # 28 октября - 2 ноября 1991 года
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+)-(\d{1,2}) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        day, month_name, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 1

    # 19-21 августа 1991 года
    match = re.fullmatch(
        r"(\d{1,2})-(\d{1,2}) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        start_day, _, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(start_day), 1

    # 23 января 1991 года
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        day, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # 5 (17) сентября 1809 года
    match = re.fullmatch(
        r"(\d{1,2}) \(\d{1,2}\) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        day, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # 30 апреля (13 мая) 1918 года
    # Для межстилевых дат одного года сортируем по старому стилю.
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+) \((\d{1,2}) ([а-яё]+)\) (\d{1,4}) года",
        value,
    )
    if match:
        day, month_name, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # 28 декабря 1809 (9 января 1810) года
    # Для межгодовых дат по старому и новому стилям сортируем по старому стилю.
    match = re.fullmatch(
        r"(\d{1,2}) ([а-яё]+) (\d{1,4}) \(\d{1,2} [а-яё]+ \d{1,4}\) года",
        value,
    )
    if match:
        day, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # Ночь с 4 на 5 июня 1993 года,
    # Ночь с 26 на 27 февраля (11 на 12 марта) 1917 года
    # Начальная дата ночи — первый указанный день, месяц — из первого месяца.
    match = re.fullmatch(
        r"ночь с (\d{1,2}) на (\d{1,2}) ([а-яё]+)(?: \((\d{1,2}) на (\d{1,2}) ([а-яё]+)\))? (\d{1,4}) года",
        value,
    )
    if match:
        day, _, month_name, _, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # Ночь с 6 (19) на 7 (20) января 1918 года,
    # Ночь с 11 (23) на 12 (24) марта 1801 года
    match = re.fullmatch(
        r"ночь с (\d{1,2}) \((\d{1,2})\) на (\d{1,2}) \((\d{1,2})\) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        day, _, _, _, month_name, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # Ночь с 31 января на 14 февраля 1918 года
    match = re.fullmatch(
        r"ночь с (\d{1,2}) ([а-яё]+) на (\d{1,2}) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        day, month_name, _, _, year = match.groups()
        return int(year), MONTHS[month_name], int(day), 0

    # апрель - 16 ноября 1920 года
    match = re.fullmatch(
        r"([а-яё]+)-(\d{1,2}) ([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        month_name, _, _, year = match.groups()
        return int(year), MONTHS[month_name], 32, 1

    # июнь - июль 1917 года
    match = re.fullmatch(
        r"([а-яё]+)-([а-яё]+) (\d{1,4}) года",
        value,
    )
    if match:
        month_name, _, year = match.groups()
        return int(year), MONTHS[month_name], 32, 1

    # июнь 1991 года
    match = re.fullmatch(r"([а-яё]+) (\d{1,4}) года", value)
    if match:
        month_name, year = match.groups()

        # День 32 означает: после всех точных дат этого месяца.
        return int(year), MONTHS[month_name], 32, 1

    # 1943 год, 1943 год (итог)
    match = re.fullmatch(r"(\d{1,4}) год(?:\s*\(.+\))?", value)
    if match:
        # Месяц 13 означает: после всех датированных событий этого года.
        return int(match.group(1)), 13, 0, 2

    # 1965-1973 годы
    match = re.fullmatch(r"(\d{1,4})-(\d{1,4}) годы", value)
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
    parser.add_argument(
        "timeline",
        type=Path,
        help="Файл .md или папка категории (Russia, USA, Common).",
    )
    parser.add_argument(
        "--date",
        required=True,
        help=(
            "Точная дата в формате YYYY-MM-DD. Текстовые даты и периоды "
            "поддерживаются для обратной совместимости."
        ),
    )
    parser.add_argument(
        "--calendar",
        choices=("new", "old"),
        default="new",
        help=(
            "Календарь, в котором передана точная дата: new (по умолчанию) "
            "или old. Используется только с YYYY-MM-DD."
        ),
    )
    parser.add_argument("--event", required=True, type=Path)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Вывести результат, не изменяя файл.",
    )

    args = parser.parse_args()

    numeric_match = re.fullmatch(r"\d{1,4}-\d{2}-\d{2}", args.date)
    if numeric_match:
        try:
            input_date = date.fromisoformat(args.date.zfill(10))
        except ValueError as error:
            parser.error(f"Некорректная дата {args.date!r}: {error}")

        numeric_date = numeric_date_label(
            input_date,
            args.calendar,
            is_russia_target(args.timeline),
        )
        date_label = numeric_date.label
        timeline_path = resolve_timeline_path(
            args.timeline,
            numeric_date.primary_date.year,
        )
    else:
        if args.calendar != "new" or re.fullmatch(r"\d{1,4}-.*", args.date):
            parser.error(
                "--calendar можно указывать только с точной датой YYYY-MM-DD."
            )
        try:
            year, _, _, _ = parse_date_key(args.date)
        except ValueError as error:
            parser.error(str(error))
        date_label = args.date
        timeline_path = resolve_timeline_path(args.timeline, year)

    if timeline_path.exists():
        original_text = timeline_path.read_text(encoding="utf-8")
    else:
        original_text = ""
        if not args.dry_run:
            timeline_path.parent.mkdir(parents=True, exist_ok=True)
            timeline_path.touch()
    event_text = args.event.read_text(encoding="utf-8")

    preamble, blocks = split_document(original_text)
    add_event(blocks, date_label, event_text)

    result = render_document(preamble, blocks)

    if args.dry_run:
        print(result)
    else:
        atomic_write(timeline_path, result)
        print(f"Событие добавлено: {date_label}")
        print(f"Файл хронологии: {timeline_path}")
        print(f"Резервная копия: {timeline_path}.bak")


if __name__ == "__main__":
    main()
