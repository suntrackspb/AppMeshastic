# -*- mode: python ; coding: utf-8 -*-
import sys
import certifi
from pathlib import Path

block_cipher = None

a = Analysis(
    ['run.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        ('app/frontend', 'app/frontend'),
        (certifi.where(), 'certifi'),
    ],
    hiddenimports=[
        # pywebview platform backends
        'webview.platforms.cocoa',
        'webview.platforms.winforms',
        'webview.platforms.gtk',
        'webview.platforms.qt',
        # meshtastic internals
        'meshtastic',
        'meshtastic.mesh_pb2',
        'meshtastic.portnums_pb2',
        'meshtastic.telemetry_pb2',
        # bleak BLE
        'bleak',
        'bleak.backends.corebluetooth',
        'bleak.backends.winrt',
        'bleak.backends.bluezdbus',
        # pubsub (used by meshtastic)
        'pubsub',
        'pubsub.core',
        # async
        'aiosqlite',
        'websockets',
        # update
        'httpx',
        'packaging',
        'packaging.version',
        # SSL certificates
        'certifi',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='AppMeshastic',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

# macOS .app bundle
if sys.platform == 'darwin':
    app = BUNDLE(
        exe,
        name='AppMeshastic.app',
        icon=None,
        bundle_identifier='com.appmeshastic.app',
        info_plist={
            'NSBluetoothAlwaysUsageDescription': 'Required for BLE Meshtastic connections',
            'NSBluetoothPeripheralUsageDescription': 'Required for BLE Meshtastic connections',
        },
    )
