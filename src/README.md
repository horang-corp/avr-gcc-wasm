# Firmware Source

Put your product firmware source at:

```text
src/HorangFirmware.cpp
```

That file is intentionally ignored by git in this repository.

The browser builder expects the firmware to support these preprocessor flags:

```cpp
#ifndef USE_OLED
#define USE_OLED 0
#endif

#ifndef USE_TOF
#define USE_TOF 0
#endif
```
