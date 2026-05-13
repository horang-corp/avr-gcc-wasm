import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp as fsCp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnFile } from "./spawn-file.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CACHE_DIR = process.env.AVR_GCC_WASM_CACHE || join(ROOT, ".cache", "vendor");
const WORK_DIR = process.env.AVR_GCC_WASM_WORK || join(ROOT, ".cache", "work");
const ASSETS_DIR = process.env.AVR_GCC_WASM_ASSETS || join(ROOT, "assets");

const ARDUINO_PLATFORM_VERSION = "1.8.7";
const AVR_GCC_VERSION = "7.3.0-atmel3.6.1-arduino7";

const LIBRARIES = [
  { indexName: "Servo", outName: "Servo", version: "1.3.0" },
  { indexName: "Firmata", outName: "Firmata", version: "2.5.9" },
  { indexName: "Adafruit BMP085 Library", outName: "Adafruit_BMP085_Library", version: "1.2.4" },
  { indexName: "DHT sensor library", outName: "DHT_sensor_library", version: "1.4.7" },
  { indexName: "Adafruit GFX Library", outName: "Adafruit_GFX_Library", version: "1.12.6" },
  { indexName: "Adafruit SSD1306", outName: "Adafruit_SSD1306", version: "2.5.16" },
  { indexName: "VL53L0X", outName: "VL53L0X", version: "1.3.1" },
  { indexName: "Adafruit BusIO", outName: "Adafruit_BusIO", version: "1.17.4" },
  { indexName: "Adafruit Unified Sensor", outName: "Adafruit_Unified_Sensor", version: "1.1.15" },
];

const HEADER_EXTENSIONS = new Set([".h", ".hpp", ".hh", ".hxx"]);

const CORE_C_SOURCES = [
  ["cores/arduino/hooks.c", "core_hooks.o"],
  ["cores/arduino/wiring.c", "core_wiring.o"],
  ["cores/arduino/wiring_analog.c", "core_wiring_analog.o"],
  ["cores/arduino/wiring_digital.c", "core_wiring_digital.o"],
  ["cores/arduino/wiring_pulse.c", "core_wiring_pulse.o"],
  ["cores/arduino/wiring_shift.c", "core_wiring_shift.o"],
];

const CORE_CPP_SOURCES = [
  ["cores/arduino/main.cpp", "core_main.o"],
  ["cores/arduino/abi.cpp", "core_abi.o"],
  ["cores/arduino/HardwareSerial.cpp", "core_HardwareSerial.o"],
  ["cores/arduino/HardwareSerial0.cpp", "core_HardwareSerial0.o"],
  ["cores/arduino/Print.cpp", "core_Print.o"],
  ["cores/arduino/Stream.cpp", "core_Stream.o"],
  ["cores/arduino/Tone.cpp", "core_Tone.o"],
  ["cores/arduino/WMath.cpp", "core_WMath.o"],
  ["cores/arduino/WString.cpp", "core_WString.o"],
  ["cores/arduino/new.cpp", "core_new.o"],
];

const LIB_C_SOURCES = [
  ["arduino/libraries/Wire/src/utility/twi.c", "lib_twi.o"],
];

const LIB_CPP_SOURCES = [
  ["arduino/libraries/Wire/src/Wire.cpp", "lib_Wire.o"],
  ["arduino/libraries/SPI/src/SPI.cpp", "lib_SPI.o"],
  ["libraries/Servo/src/avr/Servo.cpp", "lib_Servo.o"],
  ["libraries/Firmata/Firmata.cpp", "lib_Firmata.o"],
  ["libraries/Firmata/FirmataMarshaller.cpp", "lib_FirmataMarshaller.o"],
  ["libraries/Firmata/FirmataParser.cpp", "lib_FirmataParser.o"],
  ["libraries/Adafruit_BusIO/Adafruit_BusIO_Register.cpp", "lib_BusIO_Register.o"],
  ["libraries/Adafruit_BusIO/Adafruit_I2CDevice.cpp", "lib_I2CDevice.o"],
  ["libraries/Adafruit_BusIO/Adafruit_SPIDevice.cpp", "lib_SPIDevice.o"],
  ["libraries/Adafruit_BMP085_Library/Adafruit_BMP085.cpp", "lib_BMP085.o"],
  ["libraries/DHT_sensor_library/DHT.cpp", "lib_DHT.o"],
  ["libraries/Adafruit_GFX_Library/Adafruit_GFX.cpp", "lib_GFX.o"],
  ["libraries/Adafruit_SSD1306/Adafruit_SSD1306.cpp", "lib_SSD1306.o"],
  ["libraries/VL53L0X/VL53L0X.cpp", "lib_VL53L0X.o"],
];

const OBJECT_GROUPS = {
  base: [
    "/objects/core_HardwareSerial.o",
    "/objects/core_HardwareSerial0.o",
    "/objects/core_Print.o",
    "/objects/core_Stream.o",
    "/objects/core_Tone.o",
    "/objects/core_WMath.o",
    "/objects/core_WString.o",
    "/objects/core_hooks.o",
    "/objects/core_main.o",
    "/objects/core_new.o",
    "/objects/core_wiring.o",
    "/objects/core_wiring_analog.o",
    "/objects/core_wiring_digital.o",
    "/objects/core_wiring_pulse.o",
    "/objects/core_wiring_pulse_asm.o",
    "/objects/core_wiring_shift.o",
    "/objects/lib_BMP085.o",
    "/objects/lib_BusIO_Register.o",
    "/objects/lib_DHT.o",
    "/objects/lib_Firmata.o",
    "/objects/lib_FirmataMarshaller.o",
    "/objects/lib_FirmataParser.o",
    "/objects/lib_I2CDevice.o",
    "/objects/lib_SPI.o",
    "/objects/lib_SPIDevice.o",
    "/objects/lib_Servo.o",
    "/objects/lib_Wire.o",
    "/objects/lib_twi.o",
  ],
  oled: ["/objects/lib_GFX.o", "/objects/lib_SSD1306.o"],
  tof: ["/objects/lib_VL53L0X.o"],
};

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await rm(WORK_DIR, { recursive: true, force: true });
  await rm(ASSETS_DIR, { recursive: true, force: true });
  await mkdir(WORK_DIR, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });

  const packageIndex = await fetchJson("https://downloads.arduino.cc/packages/package_index.json");
  const libraryIndex = await fetchJson("https://downloads.arduino.cc/libraries/library_index.json");

  const platform = findArduinoAvrPlatform(packageIndex);
  const tool = findAvrGccTool(packageIndex);
  const libraryArchives = LIBRARIES.map((library) => findLibrary(libraryIndex, library));

  const platformRoot = await downloadAndExtract(platform, "platform");
  const toolchainRoot = await downloadAndExtract(tool, "toolchain");
  const libraryRoots = {};

  for (const library of libraryArchives) {
    libraryRoots[library.outName] = await downloadAndExtract(library, `library-${library.outName}`);
  }

  await copyAssets(platformRoot, toolchainRoot, libraryRoots);
  await compileObjects(platformRoot, toolchainRoot, libraryRoots);
  await writeManifest();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

function findArduinoAvrPlatform(index) {
  const packager = index.packages.find((entry) => entry.name === "arduino");
  const platform = packager?.platforms.find((entry) => entry.architecture === "avr" && entry.version === ARDUINO_PLATFORM_VERSION);
  if (!platform) throw new Error(`Arduino AVR platform ${ARDUINO_PLATFORM_VERSION} not found`);
  return platform;
}

function findAvrGccTool(index) {
  const host = hostName();
  const packager = index.packages.find((entry) => entry.name === "arduino");
  const tool = packager?.tools.find((entry) => entry.name === "avr-gcc" && entry.version === AVR_GCC_VERSION);
  const system = tool?.systems.find((entry) => entry.host === host);
  if (!system) throw new Error(`avr-gcc ${AVR_GCC_VERSION} for host ${host} not found`);
  return { ...system, name: "avr-gcc", version: AVR_GCC_VERSION };
}

function findLibrary(index, request) {
  const library = index.libraries.find((entry) => entry.name === request.indexName && entry.version === request.version);
  if (!library) throw new Error(`${request.indexName} ${request.version} not found`);
  return { ...library, outName: request.outName };
}

function hostName() {
  if (process.platform !== "linux") {
    throw new Error(`prepare-assets currently supports Linux hosts only, got ${process.platform}`);
  }

  if (process.arch === "x64") return "x86_64-linux-gnu";
  if (process.arch === "arm64") return "aarch64-linux-gnu";
  if (process.arch === "arm") return "arm-linux-gnueabihf";
  if (process.arch === "ia32") return "i686-linux-gnu";
  throw new Error(`Unsupported Linux architecture: ${process.arch}`);
}

async function downloadAndExtract(entry, name) {
  const archivePath = join(CACHE_DIR, entry.archiveFileName || basename(new URL(entry.url).pathname));
  await download(entry.url, archivePath, entry.checksum);

  const outDir = join(WORK_DIR, name);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  if (archivePath.endsWith(".zip")) {
    await spawnFile("unzip", ["-q", archivePath, "-d", outDir]);
  } else {
    await spawnFile("tar", ["-xf", archivePath, "-C", outDir]);
  }

  return firstDirectory(outDir);
}

async function download(url, target, checksum) {
  if (await fileMatches(target, checksum)) return;

  await mkdir(dirname(target), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to download ${url}: ${res.status}`);
  await pipeline(res.body, createWriteStream(target));

  if (!(await fileMatches(target, checksum))) {
    throw new Error(`Checksum mismatch for ${target}`);
  }
}

async function fileMatches(path, checksum) {
  try {
    const expected = checksum?.replace(/^SHA-256:/, "").toLowerCase();
    if (!expected) return true;
    const actual = createHash("sha256").update(await readFile(path)).digest("hex");
    return actual === expected;
  } catch {
    return false;
  }
}

async function firstDirectory(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const dir = entries.find((entry) => entry.isDirectory());
  if (!dir) throw new Error(`No directory extracted under ${path}`);
  return join(path, dir.name);
}

async function copyFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await fsCp(source, target);
}

async function copyAssets(platformRoot, toolchainRoot, libraryRoots) {
  await copyHeaderTree(join(toolchainRoot, "lib/gcc/avr/7.3.0/include"), "/sysroot/gcc/include");
  await copyHeaderTree(join(toolchainRoot, "avr/include"), "/sysroot/avr/include");
  await copyHeaderTree(join(platformRoot, "cores/arduino"), "/arduino/core");
  await copyHeaderTree(join(platformRoot, "variants/standard"), "/arduino/variant");
  await copyHeaderTree(join(platformRoot, "libraries/Wire/src"), "/arduino/libraries/Wire/src");
  await copyHeaderTree(join(platformRoot, "libraries/SPI/src"), "/arduino/libraries/SPI/src");

  for (const [name, root] of Object.entries(libraryRoots)) {
    await copyHeaderTree(root, `/libraries/${name}`);
  }

  await copyFile(join(toolchainRoot, "avr/lib/avr5/crtatmega328p.o"), join(ASSETS_DIR, "libs/crtatmega328p.o"));
  await copyFile(join(toolchainRoot, "avr/lib/avr5/libc.a"), join(ASSETS_DIR, "libs/libc.a"));
  await copyFile(join(toolchainRoot, "avr/lib/avr5/libm.a"), join(ASSETS_DIR, "libs/libm.a"));
  await copyFile(join(toolchainRoot, "lib/gcc/avr/7.3.0/avr5/libgcc.a"), join(ASSETS_DIR, "libs/libgcc.a"));
  await copyFile(join(toolchainRoot, "avr/lib/ldscripts/avr5.xn"), join(ASSETS_DIR, "ldscripts/avr5.xn"));
}

async function copyHeaderTree(sourceRoot, virtualRoot) {
  for (const file of await listFiles(sourceRoot)) {
    const ext = extname(file);
    const name = basename(file);
    if (!HEADER_EXTENSIONS.has(ext) && name !== "new") continue;
    const virtualPath = join("fs", virtualRoot, relative(sourceRoot, file));
    await copyFile(file, join(ASSETS_DIR, virtualPath));
  }
}

async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out;
}

async function compileObjects(platformRoot, toolchainRoot, libraryRoots) {
  const objectsDir = join(ASSETS_DIR, "objects");
  await mkdir(objectsDir, { recursive: true });

  const avrGcc = join(toolchainRoot, "bin/avr-gcc");
  const avrGxx = join(toolchainRoot, "bin/avr-g++");

  const context = { platformRoot, toolchainRoot, libraryRoots };

  for (const [src, out] of CORE_C_SOURCES) {
    await compileC(avrGcc, resolveSource(src, context), join(objectsDir, out), context);
  }
  for (const [src, out] of CORE_CPP_SOURCES) {
    await compileCpp(avrGxx, resolveSource(src, context), join(objectsDir, out), context);
  }
  await compileAssembly(avrGcc, join(platformRoot, "cores/arduino/wiring_pulse.S"), join(objectsDir, "core_wiring_pulse_asm.o"), context);
  for (const [src, out] of LIB_C_SOURCES) {
    await compileC(avrGcc, resolveSource(src, context), join(objectsDir, out), context);
  }
  for (const [src, out] of LIB_CPP_SOURCES) {
    await compileCpp(avrGxx, resolveSource(src, context), join(objectsDir, out), context);
  }
}

function resolveSource(path, context) {
  if (path.startsWith("cores/") || path.startsWith("arduino/libraries/")) {
    return join(context.platformRoot, path.replace(/^arduino\//, ""));
  }
  if (path.startsWith("libraries/")) {
    const [, name, ...rest] = path.split("/");
    return join(context.libraryRoots[name], ...rest);
  }
  throw new Error(`Unknown source path: ${path}`);
}

function commonArgs(context) {
  return [
    "-mmcu=atmega328p",
    "-DF_CPU=16000000L",
    "-DARDUINO=10819",
    "-DARDUINO_AVR_UNO",
    "-DARDUINO_ARCH_AVR",
    "-I", join(context.platformRoot, "cores/arduino"),
    "-I", join(context.platformRoot, "variants/standard"),
    "-I", join(context.platformRoot, "libraries/Wire/src"),
    "-I", join(context.platformRoot, "libraries/SPI/src"),
    "-I", join(context.platformRoot, "libraries/Wire/src/utility"),
    "-I", join(context.libraryRoots.Servo, "src"),
    "-I", join(context.libraryRoots.Servo, "src/avr"),
    "-I", context.libraryRoots.Firmata,
    "-I", join(context.libraryRoots.Firmata, "utility"),
    "-I", context.libraryRoots.Adafruit_BMP085_Library,
    "-I", context.libraryRoots.DHT_sensor_library,
    "-I", context.libraryRoots.Adafruit_GFX_Library,
    "-I", context.libraryRoots.Adafruit_SSD1306,
    "-I", context.libraryRoots.VL53L0X,
    "-I", context.libraryRoots.Adafruit_BusIO,
    "-I", context.libraryRoots.Adafruit_Unified_Sensor,
  ];
}

async function compileC(compiler, source, output, context) {
  await spawnFile(compiler, [
    "-c", "-g", "-Os", "-w", "-std=gnu11",
    "-ffunction-sections", "-fdata-sections",
    ...commonArgs(context),
    source, "-o", output,
  ]);
}

async function compileCpp(compiler, source, output, context) {
  await spawnFile(compiler, [
    "-c", "-g", "-Os", "-w", "-std=gnu++11",
    "-fpermissive", "-fno-exceptions", "-fno-threadsafe-statics", "-fno-rtti", "-fno-enforce-eh-specs",
    "-ffunction-sections", "-fdata-sections",
    ...commonArgs(context),
    source, "-o", output,
  ]);
}

async function compileAssembly(compiler, source, output, context) {
  await spawnFile(compiler, [
    "-c", "-g", "-x", "assembler-with-cpp",
    ...commonArgs(context),
    source, "-o", output,
  ]);
}

async function writeManifest() {
  const headerFiles = (await listFiles(join(ASSETS_DIR, "fs")))
    .map((file) => `/${relative(join(ASSETS_DIR, "fs"), file)}`)
    .sort();

  const manifest = {
    generatedAt: new Date().toISOString(),
    headerFiles,
    objectGroups: OBJECT_GROUPS,
    libs: ["/libs/crtatmega328p.o", "/libs/libc.a", "/libs/libm.a", "/libs/libgcc.a"],
  };

  await writeFile(join(ASSETS_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
