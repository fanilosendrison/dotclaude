#!/usr/bin/env python3
"""
Skill test runner — structural validation + functional script tests

Usage:
    test_skill.py <skill-directory>
"""

import sys
import os
import subprocess
import re
from pathlib import Path

# Allow importing quick_validate from same directory
sys.path.insert(0, str(Path(__file__).parent))
from quick_validate import validate_skill_full


def _has_shebang(file_path):
    """Check if a file starts with a shebang line."""
    try:
        first_line = file_path.read_text().split('\n')[0]
        return first_line.startswith('#!')
    except (OSError, IndexError):
        return False


def test_python_scripts(skill_path):
    """Test Python scripts: syntax check + shebang."""
    errors = []
    warnings = []
    scripts_dir = skill_path / 'scripts'

    if not scripts_dir.exists():
        return errors, warnings, 0

    py_files = sorted(scripts_dir.glob('**/*.py'))
    for script in py_files:
        rel = str(script.relative_to(skill_path))

        # Syntax check via py_compile
        result = subprocess.run(
            [sys.executable, '-m', 'py_compile', str(script)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            errors.append(f"Syntax error in {rel}: {stderr}")
            continue

        # Shebang check
        if not _has_shebang(script):
            warnings.append(f"Missing shebang in {rel}")

    return errors, warnings, len(py_files)


def test_bash_scripts(skill_path):
    """Test Bash scripts: syntax check + shebang + permissions."""
    errors = []
    warnings = []
    scripts_dir = skill_path / 'scripts'

    if not scripts_dir.exists():
        return errors, warnings, 0

    sh_files = sorted(scripts_dir.glob('**/*.sh'))
    for script in sh_files:
        rel = str(script.relative_to(skill_path))

        # Syntax check via bash -n
        result = subprocess.run(
            ['bash', '-n', str(script)],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            stderr = result.stderr.strip()
            errors.append(f"Syntax error in {rel}: {stderr}")
            continue

        # Shebang check
        if not _has_shebang(script):
            warnings.append(f"Missing shebang in {rel}")

        # Executable permission check
        if not os.access(script, os.X_OK):
            warnings.append(f"Not executable: {rel}")

    return errors, warnings, len(sh_files)


def _print_section(title, errors, warnings, count_ok, count_total):
    """Print a formatted test section."""
    print(f"-- {title} --")
    for e in errors:
        print(f"  x {e}")
    for w in warnings:
        print(f"  ! {w}")
    if count_total > 0:
        print(f"  {count_ok}/{count_total} OK")
    elif not errors and not warnings:
        print("  All checks passed")
    print()


def test_skill(skill_path):
    """Run all tests on a skill directory. Returns True on pass."""
    skill_path = Path(skill_path).resolve()
    all_errors = []
    all_warnings = []

    print(f"Testing skill: {skill_path.name}\n")

    # 1. Structural + content validation
    errors, warnings = validate_skill_full(skill_path)
    all_errors.extend(errors)
    all_warnings.extend(warnings)
    _print_section("Validation", errors, warnings, 0, 0)

    # 2. Python script tests
    errors, warnings, total = test_python_scripts(skill_path)
    all_errors.extend(errors)
    all_warnings.extend(warnings)
    if total > 0:
        syntax_errors = sum(1 for e in errors if "Syntax error" in e)
        _print_section("Python scripts", errors, warnings, total - syntax_errors, total)

    # 3. Bash script tests
    errors, warnings, total = test_bash_scripts(skill_path)
    all_errors.extend(errors)
    all_warnings.extend(warnings)
    if total > 0:
        syntax_errors = sum(1 for e in errors if "Syntax error" in e)
        _print_section("Bash scripts", errors, warnings, total - syntax_errors, total)

    # 4. Summary
    print("-- Summary --")
    if all_errors:
        print(f"  {len(all_errors)} error(s), {len(all_warnings)} warning(s)")
        print("  FAIL")
        return False
    elif all_warnings:
        print(f"  0 errors, {len(all_warnings)} warning(s)")
        print("  PASS (with warnings)")
        return True
    else:
        print("  0 errors, 0 warnings")
        print("  PASS")
        return True


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: test_skill.py <skill-directory>")
        sys.exit(1)

    success = test_skill(sys.argv[1])
    sys.exit(0 if success else 1)
