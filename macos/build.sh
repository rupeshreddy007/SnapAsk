#!/bin/zsh
# Builds build/SnapAsk.app. Requires Xcode Command Line Tools (xcode-select --install).
set -e
cd "$(dirname "$0")"
APP=build/SnapAsk.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -framework Cocoa -framework Carbon -o "$APP/Contents/MacOS/SnapAsk" Sources/main.swift
cp Info.plist "$APP/Contents/Info.plist"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Built $APP"
echo "Run:      open $APP"
echo "Install:  cp -R $APP /Applications/   (then add it to System Settings → General → Login Items)"
