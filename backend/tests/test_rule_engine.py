from app.main import normalize


def test_normalize_is_case_and_whitespace_insensitive():
    assert normalize("  MOHAMED   Saleh ") == "mohamed saleh"
