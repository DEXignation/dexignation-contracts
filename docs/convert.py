#!/usr/bin/env python3
"""
Convert bilingual ADR markdown from "English para / Korean para interleaved"
to "English primary + <details> collapsible Korean".

Strategy per subsection (### header):
  - Split body into paragraphs (separated by blank lines)
  - Classify each paragraph as English or Korean by character heuristic
    (Korean = contains any Hangul, Han, or Hangul-Jamo character)
  - Group consecutive English paragraphs as "English block"
  - Group consecutive Korean paragraphs as "Korean block"
  - Pair them: each English block → Korean block (typically 1:1)
  - Emit: English block, then <details><summary>▶ 한국어로 보기</summary>
    Korean block </details>

Edge cases handled:
  - Paragraphs that are pure code/tables/lists with no Korean text → English
  - Mixed paragraphs (one Korean word in mostly English) → English
    (we look at majority of word characters)
  - Bilingual headers stay as-is
  - Bilingual single lines like "**Status:** ... / **상태:** ..." stay as-is
"""

import re
import sys
from pathlib import Path


def is_korean_paragraph(text):
    """Return True if paragraph is primarily Korean."""
    # Strip code blocks, links, and inline code from consideration
    cleaned = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    cleaned = re.sub(r'`[^`]+`', '', cleaned)
    cleaned = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', cleaned)

    # Count Hangul (AC00-D7AF), Hangul Jamo (1100-11FF, 3130-318F)
    korean = sum(1 for c in cleaned if
                 '\uAC00' <= c <= '\uD7AF' or
                 '\u1100' <= c <= '\u11FF' or
                 '\u3130' <= c <= '\u318F')
    # Count English letters
    english = sum(1 for c in cleaned if c.isascii() and c.isalpha())

    if korean == 0:
        return False
    if english == 0:
        return True
    # Majority rule by word-character count
    return korean > english * 0.4  # Korean chars are denser, so threshold lower


def is_bilingual_header_line(text):
    """Detect lines that contain both English and Korean on a single
    line (or very short paragraph) — keep as-is, do not wrap in details."""
    stripped = text.strip()
    if not stripped:
        return False
    lines = stripped.split('\n')
    if len(lines) > 3:
        return False
    has_korean = any('\uAC00' <= c <= '\uD7AF' for c in stripped)
    has_english = any(c.isascii() and c.isalpha() for c in stripped)
    if not (has_korean and has_english):
        return False
    # Status/Date markers
    if any(m in stripped for m in ['**Status:**', '**상태:**', '**Date:**', '**날짜:**']):
        return True
    # Bilingual bold single-line label like "**Preserved hooks / 보존된 확장 지점:**"
    # — pattern: starts and ends with ** and contains a slash
    if stripped.startswith('**') and stripped.endswith('**') and '/' in stripped:
        return True
    # Bilingual list item like "- **Benefits / 장점:**"
    if re.match(r'^[-*]\s*\*\*[^*]+/[^*]+\*\*\s*$', stripped):
        return True
    return False


def split_paragraphs(text):
    """Split text into paragraphs separated by blank lines.
    Preserve code blocks as atomic paragraphs."""
    paragraphs = []
    current = []
    in_code = False

    for line in text.split('\n'):
        if line.startswith('```'):
            in_code = not in_code
            current.append(line)
            if not in_code:
                # end of code block — paragraph ends here
                paragraphs.append('\n'.join(current))
                current = []
            continue

        if in_code:
            current.append(line)
            continue

        if line.strip() == '':
            if current:
                paragraphs.append('\n'.join(current))
                current = []
        else:
            current.append(line)

    if current:
        paragraphs.append('\n'.join(current))

    return paragraphs


def convert_subsection(body):
    """Convert a subsection body (text between ### headers) to
    English-primary + collapsible Korean."""
    paragraphs = split_paragraphs(body)

    # Classify each paragraph
    classified = []
    for p in paragraphs:
        if not p.strip():
            continue
        if is_bilingual_header_line(p):
            classified.append(('bilingual', p))
        elif is_korean_paragraph(p):
            classified.append(('ko', p))
        else:
            classified.append(('en', p))

    # Group consecutive same-language paragraphs
    groups = []
    current_lang = None
    current_paras = []
    for lang, p in classified:
        if lang == 'bilingual':
            # Flush current group, then emit bilingual as its own group
            if current_paras:
                groups.append((current_lang, current_paras))
                current_paras = []
                current_lang = None
            groups.append(('bilingual', [p]))
        elif lang == current_lang:
            current_paras.append(p)
        else:
            if current_paras:
                groups.append((current_lang, current_paras))
            current_lang = lang
            current_paras = [p]
    if current_paras:
        groups.append((current_lang, current_paras))

    # Pair English groups with following Korean groups
    output_parts = []
    i = 0
    while i < len(groups):
        lang, paras = groups[i]
        if lang == 'bilingual':
            output_parts.append('\n\n'.join(paras))
            i += 1
        elif lang == 'en':
            en_text = '\n\n'.join(paras)
            # Check if next group is Korean
            if i + 1 < len(groups) and groups[i + 1][0] == 'ko':
                ko_text = '\n\n'.join(groups[i + 1][1])
                output_parts.append(
                    en_text + '\n\n' +
                    '<details>\n<summary>▶ 한국어로 보기</summary>\n\n' +
                    ko_text + '\n\n</details>\n'
                )
                i += 2
            else:
                output_parts.append(en_text)
                i += 1
        elif lang == 'ko':
            # Orphan Korean group (no preceding English) — wrap as standalone
            ko_text = '\n\n'.join(paras)
            output_parts.append(
                '<details>\n<summary>▶ 한국어로 보기</summary>\n\n' +
                ko_text + '\n\n</details>\n'
            )
            i += 1
        else:
            i += 1

    return '\n\n'.join(output_parts)


def convert_document(text):
    """Convert entire document. Process H1 intro, then each H2 (ADR) block,
    splitting by H3 subsections inside each H2."""
    # Split by H2 (## )
    h2_pattern = re.compile(r'^(## .+)$', re.MULTILINE)
    h2_positions = [(m.start(), m.group(1)) for m in h2_pattern.finditer(text)]

    if not h2_positions:
        return text

    # Intro = everything before first H2
    intro_end = h2_positions[0][0]
    intro = text[:intro_end]

    # Convert intro paragraphs too
    converted_intro = convert_subsection(intro.split('---')[0]) if intro.strip() else ''
    # Preserve the trailing --- if present
    intro_trailing = '---\n\n' if '---' in intro else ''

    sections = []
    for idx, (start, header) in enumerate(h2_positions):
        end = h2_positions[idx + 1][0] if idx + 1 < len(h2_positions) else len(text)
        section = text[start:end]

        # Process this H2 section: keep H2 header, split by H3
        h3_pattern = re.compile(r'^(### .+)$', re.MULTILINE)
        h3_positions = [(m.start(), m.group(1)) for m in h3_pattern.finditer(section)]

        if not h3_positions:
            # No H3 subsections; convert the whole body
            h2_end_match = re.search(r'^## .+\n', section)
            if h2_end_match:
                h2_line = section[:h2_end_match.end()]
                body = section[h2_end_match.end():]
                sections.append(h2_line + convert_subsection(body))
            else:
                sections.append(section)
            continue

        # H2 header + preamble (between H2 and first H3)
        first_h3_start = h3_positions[0][0]
        h2_line_end = section.find('\n') + 1
        h2_line = section[:h2_line_end]
        preamble = section[h2_line_end:first_h3_start]
        converted_preamble = convert_subsection(preamble) if preamble.strip() else ''

        out = [h2_line]
        if converted_preamble:
            out.append('\n' + converted_preamble + '\n')

        for h3_idx, (h3_start, h3_header) in enumerate(h3_positions):
            h3_end = h3_positions[h3_idx + 1][0] if h3_idx + 1 < len(h3_positions) else len(section)
            h3_line_end = section.find('\n', h3_start) + 1
            h3_line = section[h3_start:h3_line_end]
            body = section[h3_line_end:h3_end]
            converted_body = convert_subsection(body)
            # Ensure blank line before H3 header
            out.append('\n\n' + h3_line + '\n' + converted_body)

        sections.append(''.join(out))

    result = converted_intro + ('\n\n' + intro_trailing if intro_trailing else '\n\n') + '\n\n'.join(sections)
    # Clean up excessive blank lines
    result = re.sub(r'\n{4,}', '\n\n\n', result)
    return result


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: convert.py <input.md> <output.md>")
        sys.exit(1)

    src = Path(sys.argv[1]).read_text(encoding='utf-8')
    converted = convert_document(src)
    Path(sys.argv[2]).write_text(converted, encoding='utf-8')
    print(f"Converted: {sys.argv[1]} -> {sys.argv[2]}")
    print(f"  Input: {len(src.split(chr(10)))} lines, {len(src)} chars")
    print(f"  Output: {len(converted.split(chr(10)))} lines, {len(converted)} chars")
