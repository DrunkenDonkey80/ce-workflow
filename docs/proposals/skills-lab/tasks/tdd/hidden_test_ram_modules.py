# Hidden acceptance test for the tdd task: copied into tests/ only after the run ends.
import pytest

from dealfinder.normalize import clean, normalize, ram, storage


@pytest.mark.parametrize("title, total", [
    ("thinkpad t14 2x8gb ddr4", 16),
    ("thinkpad t14 8+8gb ram", 16),
    ("thinkpad t14 2 x 16 gb ram", 32),
    ("thinkpad t14 8gb + 8gb ram", 16),
    ("thinkpad t14 16gb (2x8gb) ram", 16),  # total already stated: not 32
    ("thinkpad t14 8gb ram 2x512gb ssd", 8),  # storage modules are not RAM
    ("thinkpad p15 quadro t1000 4gb 2x16gb ddr4", 32),  # graphics memory is not RAM
    ("thinkpad t14 2x8gb 512gb ssd", 16),
    ("thinkpad t14 16gb ram", 16),
    ("thinkpad t480 8gb 256gb", 8),
])
def test_ram_modules_count_as_total(title, total):
    assert ram(clean(title)) == total


def test_storage_unchanged_by_ram_modules():
    assert storage(clean("thinkpad t14 2x8gb ddr4 512gb ssd")) == 512


def test_module_ram_reaches_the_spec():
    spec = normalize("olx", {"title": "Lenovo ThinkPad T14 Gen 2 i5-1135G7 2x8GB DDR4 512GB SSD"})
    assert spec["ram_gb"] == 16
