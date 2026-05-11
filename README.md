# AppMeshastic

Десктопный клиент [Meshtastic](https://meshtastic.org/) с нативным оконным интерфейсом для macOS, Windows и Linux.

![Version](https://img.shields.io/badge/version-0.1.5-blue)
![Python](https://img.shields.io/badge/python-3.11+-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

## Возможности

- **Подключение к узлам** по Serial, BLE (Bluetooth Low Energy) и Wi-Fi/TCP
- **Чат** — отправка и получение сообщений по каналам mesh-сети в реальном времени
- **Реакции** на сообщения и подтверждения доставки (ACK)
- **Список узлов** — просмотр активных нод сети с именами и временем последней активности
- **Traceroute** — трассировка маршрута до узла в сети
- **Mirror-мост** — получение сообщений из mqtt через зеркало (https://mirror.etohost.ru)
- **Mirror-cache** — получение списка нод так же из зеркала.
- **История подключений** — сохранение и быстрый повтор последних соединений
- **Автообновление** — фоновая проверка новых релизов на GitHub с установкой в один клик
- **Мульти-нода** — одновременное подключение к нескольким устройствам с переключением активного узла

## Технологии

| Уровень | Стек |
|---------|------|
| GUI | [pywebview](https://pywebview.flowrl.com/) — нативное окно с WebKit |
| Frontend | Vanilla JS (ES-модули), HTML/CSS |
| Backend | Python 3.11+, asyncio |
| Meshtastic | [meshtastic-python](https://github.com/meshtastic/python) |
| BLE | [bleak](https://github.com/hbldh/bleak) |
| БД | [aiosqlite](https://github.com/omnilib/aiosqlite) (сообщения, узлы) |
| Сеть | httpx, websockets, certifi |
| Сборка | [hatchling](https://hatch.pypa.io/), [PyInstaller](https://pyinstaller.org/) |

## Установка и запуск

[RELEASES for Mac_x86_64, Mac_arm64, Windows_x64, Linux_x64](https://github.com/suntrackspb/AppMeshastic/releases/latest)

## Лицензия

MIT
