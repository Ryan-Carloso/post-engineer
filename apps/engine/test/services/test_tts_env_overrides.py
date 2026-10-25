from app.config.config import apply_tts_env_overrides


def _sections():
    return {
        "chatterbox": {"base_url": "https://old.modal.run/v1", "api_key": "toml-key", "model_id": "chatterbox"},
        "cloned_voices": {"registry_base_url": "https://old.modal.run", "registry_api_key": "toml-reg"},
    }


def test_env_values_override_config_toml():
    sections = _sections()
    apply_tts_env_overrides(
        sections,
        {
            "MPT_CHATTERBOX_BASE_URL": "http://tts:4123/v1",
            "MPT_CHATTERBOX_API_KEY": "secret",
            "MPT_CLONED_VOICES_REGISTRY_BASE_URL": "http://tts:4123",
            "MPT_CLONED_VOICES_REGISTRY_API_KEY": "secret-reg",
        },
    )
    assert sections == {
        "chatterbox": {"base_url": "http://tts:4123/v1", "api_key": "secret", "model_id": "chatterbox"},
        "cloned_voices": {"registry_base_url": "http://tts:4123", "registry_api_key": "secret-reg"},
    }


def test_unset_env_keeps_config_toml():
    sections = _sections()
    apply_tts_env_overrides(sections, {})
    assert sections == _sections()


def test_blank_env_keeps_config_toml():
    sections = _sections()
    apply_tts_env_overrides(
        sections,
        {
            "MPT_CHATTERBOX_BASE_URL": "",
            "MPT_CHATTERBOX_API_KEY": "   ",
            "MPT_CLONED_VOICES_REGISTRY_BASE_URL": "",
            "MPT_CLONED_VOICES_REGISTRY_API_KEY": " ",
        },
    )
    assert sections == _sections()


def test_env_value_is_stripped():
    sections = _sections()
    apply_tts_env_overrides(sections, {"MPT_CHATTERBOX_BASE_URL": "  http://tts:4123/v1\n"})
    assert sections["chatterbox"]["base_url"] == "http://tts:4123/v1"
    assert sections["chatterbox"]["api_key"] == "toml-key"


def test_each_variable_targets_only_its_own_key():
    cases = {
        "MPT_CHATTERBOX_BASE_URL": ("chatterbox", "base_url"),
        "MPT_CHATTERBOX_API_KEY": ("chatterbox", "api_key"),
        "MPT_CLONED_VOICES_REGISTRY_BASE_URL": ("cloned_voices", "registry_base_url"),
        "MPT_CLONED_VOICES_REGISTRY_API_KEY": ("cloned_voices", "registry_api_key"),
    }
    for env_name, (section, key) in cases.items():
        sections = _sections()
        apply_tts_env_overrides(sections, {env_name: "new"})
        expected = _sections()
        expected[section][key] = "new"
        assert sections == expected, env_name
