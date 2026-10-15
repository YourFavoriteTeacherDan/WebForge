/**
 * WebForge 1.20.1 Client & Persistent IndexedDB Dependency Engine (v4)
 *
 * Includes:
 * 1. Binary ZIP/JAR Scrubber (`scrubJarHeadersInPlace`) that neutralizes embedded
 *    `version.json` AND `log4j2.xml` inside JARs so Minecraft 1.20.1 uses
 *    `DetectedVersion.BUILT_IN` and our safe `/str/log4j2.xml` (preventing
 *    `UnsatisfiedLinkError: Java_java_lang_SecurityManager_getClassContext` and
 *    `TerminalConsoleAppender` pipe errors).
 * 2. Automatic Artifact Deduplicator so having 168 JARs from multiple Minecraft
 *    versions in your Prism `libraries/` folder never causes version clashes
 *    (like `oshi-core-6.2.2` vs `oshi-core-6.9.0`).
 */

const MOJANG_VERSION_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

const LWJGL3_CORE_JARS = [
  "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar"
];

const FORGE_1201_MAVEN_LIBS = [
  "https://maven.minecraftforge.net/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar",
  "https://maven.minecraftforge.net/cpw/mods/securejarhandler/2.1.10/securejarhandler-2.1.10.jar",
  "https://maven.minecraftforge.net/cpw/mods/modlauncher/10.0.9/modlauncher-10.0.9.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/fmlloader/1.20.1-47.4.28/fmlloader-1.20.1-47.4.28.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/fmlcore/1.20.1-47.4.28/fmlcore-1.20.1-47.4.28.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/javafmllanguage/1.20.1-47.4.28/javafmllanguage-1.20.1-47.4.28.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/lowcodelanguage/1.20.1-47.4.28/lowcodelanguage-1.20.1-47.4.28.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/mclanguage/1.20.1-47.4.28/mclanguage-1.20.1-47.4.28.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/forgespi/7.0.1/forgespi-7.0.1.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/eventbus/6.0.5/eventbus-6.0.5.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/coremods/5.0.1/coremods-5.0.1.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/unsafe/0.2.0/unsafe-0.2.0.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/mergetool/1.1.5/mergetool-1.1.5-api.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/JarJarSelector/0.3.19/JarJarSelector-0.3.19.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/JarJarMetadata/0.3.19/JarJarMetadata-0.3.19.jar",
  "https://maven.minecraftforge.net/net/minecraftforge/JarJarFileSystems/0.3.19/JarJarFileSystems-0.3.19.jar",
  "https://maven.minecraftforge.net/org/spongepowered/mixin/0.8.5/mixin-0.8.5.jar",
  "https://libraries.minecraft.net/org/ow2/asm/asm/9.5/asm-9.5.jar",
  "https://libraries.minecraft.net/org/ow2/asm/asm-commons/9.5/asm-commons-9.5.jar",
  "https://libraries.minecraft.net/org/ow2/asm/asm-tree/9.5/asm-tree-9.5.jar",
  "https://libraries.minecraft.net/org/ow2/asm/asm-util/9.5/asm-util-9.5.jar",
  "https://libraries.minecraft.net/org/ow2/asm/asm-analysis/9.5/asm-analysis-9.5.jar",
  "https://maven.minecraftforge.net/com/electronwill/night-config/core/3.6.4/core-3.6.4.jar",
  "https://maven.minecraftforge.net/com/electronwill/night-config/toml/3.6.4/toml-3.6.4.jar",
  "https://maven.minecraftforge.net/org/apache/maven/maven-artifact/3.8.5/maven-artifact-3.8.5.jar",
  "https://maven.minecraftforge.net/net/jodah/typetools/0.6.3/typetools-0.6.3.jar"
];

// Official Minecraft 1.20.1 Library Filenames (Preferred when deduplicating Prism folder)
const PREFERRED_1201_JARS = new Set([
  "ca-objc-1.2.jar", " text2speech-1.17.9.jar", "oshi-core-6.2.2.jar",
  "jna-5.12.1.jar", "jna-platform-5.12.1.jar", "slf4j-api-2.0.1.jar",
  "icu4j-71.1.jar", "netty-buffer-4.1.82.Final.jar", "netty-codec-4.1.82.Final.jar",
  "netty-common-4.1.82.Final.jar", "netty-handler-4.1.82.Final.jar",
  "netty-resolver-4.1.82.Final.jar", "netty-transport-4.1.82.Final.jar",
  "netty-transport-classes-epoll-4.1.82.Final.jar", "netty-transport-native-unix-common-4.1.82.Final.jar",
  "patchy-2.2.10.jar", "commons-lang3-3.12.0.jar", "commons-io-2.11.0.jar",
  "commons-codec-1.15.jar", "brigadier-1.1.8.jar", "datafixerupper-6.0.8.jar",
  "gson-2.10.jar", "authlib-4.0.43.jar", "commons-compress-1.21.jar",
  "httpclient-4.5.13.jar", "httpcore-4.4.15.jar", "commons-logging-1.2.jar",
  "fastutil-8.5.9.jar", "log4j-api-2.19.0.jar", "log4j-core-2.19.0.jar",
  "log4j-slf4j2-impl-2.19.0.jar", "guava-31.1-jre.jar", "failureaccess-1.0.1.jar",
  "jsr305-3.0.2.jar", "joml-1.10.5.jar", "jopt-simple-5.0.4.jar"
]);

/**
 * Scrubs ZIP/JAR headers in-place:
 * 1. Renames root `version.json` -> `_ersion.json` so DetectedVersion uses BUILT_IN.
 * 2. Renames root `log4j2.xml` -> `_og4j2.xml` so Log4j2 uses `/str/log4j2.xml`
 *    (which uses `%ex` instead of `%xEx`/`%tEx`, preventing `SecurityManager.getClassContext`).
 */
function scrubJarHeadersInPlace(bytes, jarName, log) {
  if (!bytes || bytes.byteLength < 30) return bytes;
  const len = bytes.byteLength - 12;

  for (let i = 0; i <= len; i++) {
    const prevByte = i > 0 ? bytes[i - 1] : 0;
    if (prevByte === 0x2f /* '/' */) continue;

    // Match "version.json" (76 65 72 73 69 6f 6e 2e 6a 73 6f 6e)
    if (
      bytes[i] === 0x76 && bytes[i + 1] === 0x65 && bytes[i + 2] === 0x72 &&
      bytes[i + 3] === 0x73 && bytes[i + 4] === 0x69 && bytes[i + 5] === 0x6f &&
      bytes[i + 6] === 0x6e && bytes[i + 7] === 0x2e && bytes[i + 8] === 0x6a &&
      bytes[i + 9] === 0x73 && bytes[i + 10] === 0x6f && bytes[i + 11] === 0x6e
    ) {
      bytes[i] = 0x5f; // '_ersion.json'
    }

    // Match "log4j2.xml" (6c 6f 67 34 6a 32 2e 78 6d 6c)
    if (
      bytes[i] === 0x6c && bytes[i + 1] === 0x6f && bytes[i + 2] === 0x67 &&
      bytes[i + 3] === 0x34 && bytes[i + 4] === 0x6a && bytes[i + 5] === 0x32 &&
      bytes[i + 6] === 0x2e && bytes[i + 7] === 0x78 && bytes[i + 8] === 0x6d &&
      bytes[i + 9] === 0x6c
    ) {
      bytes[i] = 0x5f; // '_og4j2.xml'
    }
  }
  return bytes;
}

/**
 * Extracts the base artifact name without version numbers so we never mount two
 * versions of the same library (e.g. `oshi-core-6.2.2.jar` and `oshi-core-6.9.0.jar`).
 */
function getArtifactKey(fileName) {
  return fileName.replace(/-\d[\dA-Za-z._-]*\.jar$/i, "").toLowerCase();
}

function isValid1201LibraryJar(fileName, mode = "forge") {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".jar")) return false;
  if (lower.includes("2.9.")) return false;
  if (lower.includes("-natives-")) return false;
  if (lower.includes("macos") || lower.includes("windows")) return false;
  if (lower.includes("-installer") || lower.includes("-shim")) return false;
  if (lower.includes("terminalconsoleappender") || lower.includes("jline") || lower.includes("jansi")) return false;
  if (lower.includes("forge-") && (lower.includes("-launcher") || lower.includes("-client"))) return false;
  if (lower.startsWith("minecraft-") && !lower.includes("1.20.1")) return false;

  // In Vanilla mode, keep Forge/ModLauncher jars off the classpath
  if (mode === "vanilla") {
    if (
      lower.startsWith("forge-") ||
      lower.startsWith("fmlloader") ||
      lower.startsWith("fmlcore") ||
      lower.startsWith("modlauncher") ||
      lower.startsWith("bootstraplauncher") ||
      lower.startsWith("securejarhandler") ||
      lower.startsWith("javafmllanguage") ||
      lower.startsWith("mclanguage") ||
      lower.startsWith("lowcodelanguage") ||
      lower.startsWith("coremods")
    ) {
      return false;
    }
  }
  return true;
}

class PersistentStorageDB {
  #dbPromise = null;

  constructor() {
    this.#dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("WebForge1201StorageDB", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("prism_libs")) {
          db.createObjectStore("prism_libs");
        }
        if (!db.objectStoreNames.contains("cloud_libs")) {
          db.createObjectStore("cloud_libs");
        }
        if (!db.objectStoreNames.contains("mods")) {
          db.createObjectStore("mods");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(storeName, key) {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async set(storeName, key, uint8Array) {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const req = tx.objectStore(storeName).put(uint8Array, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getAllEntries(storeName) {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const entries = [];
        for (let i = 0; i < keysReq.result.length; i++) {
          entries.push({ name: String(keysReq.result[i]), bytes: valsReq.result[i] });
        }
        resolve(entries);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async count(storeName) {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async clearAll() {
    const db = await this.#dbPromise;
    const stores = ["prism_libs", "cloud_libs", "mods"];
    for (const s of stores) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(s, "readwrite");
        const req = tx.objectStore(s).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    }
  }
}

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
      background: #000;
      color: #eee;
      overflow: hidden;
    }
    canvas {
      width: 100%;
      height: 100%;
      display: block;
      outline: none;
    }
    .display {
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
      visibility: hidden;
      pointer-events: none;
    }
  </style>
  <canvas width="854" height="480" tabindex="-1"></canvas>
  <div class="display"></div>
`;

export default class MinecraftClient extends HTMLElement {
  #canvas;
  #display;
  #storageDB;
  #isRunning = false;

  constructor() {
    super();
    this.#storageDB = new PersistentStorageDB();

    const shadowRoot = this.attachShadow({ mode: "open" });
    shadowRoot.appendChild(template.content.cloneNode(true));

    this.#canvas = shadowRoot.querySelector("canvas");
    this.#canvas.width = 854;
    this.#canvas.height = 480;
    window.lwjglCanvasElement = this.#canvas;

    this.#display = shadowRoot.querySelector(".display");
    try {
      if (typeof cheerpjCreateDisplay === "function") {
        cheerpjCreateDisplay(-1, -1, this.#display);
      }
    } catch (_) {}

    const updateSize = () => {
      const rect = this.#canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || this.#canvas.clientWidth || 854));
      const height = Math.max(1, Math.round(rect.height || this.#canvas.clientHeight || 480));
      if (this.#canvas.width !== width || this.#canvas.height !== height) {
        this.#canvas.width = width;
        this.#canvas.height = height;
        this.#canvas.dispatchEvent(new Event("resize"));
      }
    };

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(this);
    resizeObserver.observe(this.#canvas);
    window.addEventListener("resize", updateSize);
  }

  static register() {
    if (!customElements.get("minecraft-client")) {
      customElements.define("minecraft-client", this);
    }
  }

  async getStorageSummary() {
    const [prismLibs, cloudLibs, mods] = await Promise.all([
      this.#storageDB.count("prism_libs"),
      this.#storageDB.count("cloud_libs"),
      this.#storageDB.count("mods")
    ]);
    return { prismLibs, cloudLibs, mods };
  }

  async clearLibraryCache() {
    await this.#storageDB.clearAll();
  }

  async savePrismLibsToDB(fileList, onProgress, log) {
    const jarFiles = fileList.filter(f => isValid1201LibraryJar(f.name, "forge"));
    log(`Saving ${jarFiles.length} filtered 1.20.1 JARs from Prism 'libraries/' folder into IndexedDB...`, "glfw");
    let count = 0;
    for (const file of jarFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      scrubJarHeadersInPlace(bytes, file.name, log);
      await this.#storageDB.set("prism_libs", file.name, bytes);
      count++;
      if (count % 10 === 0 || count === jarFiles.length) {
        const pct = Math.round((count / jarFiles.length) * 100);
        onProgress?.(pct, `Saving Prism Libs to DB: ${count}/${jarFiles.length}`);
      }
    }
    log(`Permanently saved ${count} Prism libraries into IndexedDB!`, "info");
  }

  async saveModsToDB(fileList, log) {
    const jarFiles = fileList.filter(f => f.name.endsWith(".jar") || f.name.endsWith(".zip"));
    for (const file of jarFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.#storageDB.set("mods", file.name, bytes);
      log(`Saved Mod '${file.name}' (${(bytes.byteLength / 1024).toFixed(1)} KB) permanently in IndexedDB!`, "info");
    }
  }

  async #fetchSmart(remoteUrl, fileName, log) {
    const fromPrism = await this.#storageDB.get("prism_libs", fileName);
    if (fromPrism && fromPrism.byteLength > 0) return new Uint8Array(fromPrism);

    const fromCloud = await this.#storageDB.get("cloud_libs", fileName);
    if (fromCloud && fromCloud.byteLength > 0) return new Uint8Array(fromCloud);

    const localCandidates = [
      new URL(fileName, import.meta.url).href,
      new URL(`libs/${fileName}`, import.meta.url).href
    ];
    for (const localUrl of localCandidates) {
      try {
        const res = await fetch(localUrl);
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.byteLength > 100 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
            await this.#storageDB.set("cloud_libs", fileName, bytes);
            return bytes;
          }
        }
      } catch (_) {}
    }

    const candidateUrls = [
      remoteUrl,
      `https://corsproxy.io/?${encodeURIComponent(remoteUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(remoteUrl)}`
    ];

    let lastErr = null;
    for (const candidate of candidateUrls) {
      try {
        const res = await fetch(candidate);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 100 && bytes[0] === 0x50 && bytes[1] === 0x4B) {
          await this.#storageDB.set("cloud_libs", fileName, bytes);
          return bytes;
        }
      } catch (err) {
        lastErr = err;
      }
    }

    throw new Error(`Could not fetch ${fileName} (${lastErr ? lastErr.message : "CORS/Network error"})`);
  }

  #mountJarToCheerpJ(virtualPath, bytes, jarName, log) {
    scrubJarHeadersInPlace(bytes, jarName, log);
    cheerpOSAddStringFile(virtualPath, bytes);
  }

  async #resolveAndMountLibraries({ mode, onProgress, log }) {
    const mountedPaths = [];
    const mountedFileNames = new Set();
    const mountedArtifactKeys = new Set();

    // 1. Mount All 7 Official LWJGL 3.3.1 Core JARs First
    onProgress(5, "Mounting LWJGL 3.3.1 JARs...");
    for (const lwjglUrl of LWJGL3_CORE_JARS) {
      const fileName = lwjglUrl.split("/").pop();
      if (mountedFileNames.has(fileName)) continue;
      try {
        const bytes = await this.#fetchSmart(lwjglUrl, fileName, log);
        const vPath = `/str/libs_${fileName}`;
        this.#mountJarToCheerpJ(vPath, bytes, fileName, log);
        mountedPaths.push(vPath);
        mountedFileNames.add(fileName);
        mountedArtifactKeys.add(getArtifactKey(fileName));
      } catch (e) {
        log(`Warning fetching ${fileName}: ${e.message}`, "warn");
      }
    }

    // 2. Mount Base minecraft-1.20.1-client.jar
    onProgress(12, "Mounting base 1.20.1 JARs...");
    log("Mounting minecraft-1.20.1-client.jar...", "net");
    const clientBytes = await this.#fetchSmart(
      new URL("minecraft-1.20.1-client.jar", import.meta.url).href,
      "minecraft-1.20.1-client.jar",
      log
    );
    this.#mountJarToCheerpJ("/str/minecraft-1.20.1-client.jar", clientBytes, "minecraft-1.20.1-client.jar", log);
    mountedPaths.push("/str/minecraft-1.20.1-client.jar");
    mountedFileNames.add("minecraft-1.20.1-client.jar");
    mountedArtifactKeys.add("minecraft-client");
    log(`Mounted /str/minecraft-1.20.1-client.jar (${(clientBytes.byteLength / 1048576).toFixed(2)} MB)`, "info");

    if (mode.startsWith("forge")) {
      log("Mounting forge-1.20.1-47.4.28-universal.jar...", "net");
      const forgeBytes = await this.#fetchSmart(
        new URL("forge-1.20.1-47.4.28-universal.jar", import.meta.url).href,
        "forge-1.20.1-47.4.28-universal.jar",
        log
      );
      this.#mountJarToCheerpJ("/str/forge-1.20.1-47.4.28-universal.jar", forgeBytes, "forge-1.20.1-47.4.28-universal.jar", log);
      mountedPaths.push("/str/forge-1.20.1-47.4.28-universal.jar");
      mountedFileNames.add("forge-1.20.1-47.4.28-universal.jar");
      mountedArtifactKeys.add("forge-universal");
      log(`Mounted /str/forge-1.20.1-47.4.28-universal.jar (${(forgeBytes.byteLength / 1048576).toFixed(2)} MB)`, "info");
    }

    try {
      const wrapperBytes = await this.#fetchSmart(
        new URL("minecraftforgelib.jar", import.meta.url).href,
        "minecraftforgelib.jar",
        log
      );
      this.#mountJarToCheerpJ("/str/minecraftforgelib.jar", wrapperBytes, "minecraftforgelib.jar", log);
      mountedPaths.push("/str/minecraftforgelib.jar");
      mountedFileNames.add("minecraftforgelib.jar");
    } catch (_) {}

    // 3. Load Saved Prism Libraries from IndexedDB (with version deduplication!)
    const savedPrismLibs = await this.#storageDB.getAllEntries("prism_libs");
    if (savedPrismLibs.length > 0) {
      // Sort so official 1.20.1 versions are picked first before 1.21+ versions
      savedPrismLibs.sort((a, b) => {
        const aPref = PREFERRED_1201_JARS.has(a.name) ? 0 : 1;
        const bPref = PREFERRED_1201_JARS.has(b.name) ? 0 : 1;
        if (aPref !== bPref) return aPref - bPref;
        return a.name.localeCompare(b.name);
      });

      log(`Deduplicating & scrubbing ${savedPrismLibs.length} libraries from IndexedDB...`, "glfw");
      let count = 0;
      for (const entry of savedPrismLibs) {
        if (mountedFileNames.has(entry.name)) continue;
        if (!isValid1201LibraryJar(entry.name, mode)) continue;

        const artifactKey = getArtifactKey(entry.name);
        if (mountedArtifactKeys.has(artifactKey)) {
          continue; // Skip duplicate version (e.g. skips oshi-core-6.9.0.jar after mounting oshi-core-6.2.2.jar)
        }

        const vPath = `/str/libs_${entry.name}`;
        const copyBytes = new Uint8Array(entry.bytes);
        this.#mountJarToCheerpJ(vPath, copyBytes, entry.name, log);
        mountedPaths.push(vPath);
        mountedFileNames.add(entry.name);
        mountedArtifactKeys.add(artifactKey);
        count++;
        if (count % 20 === 0) {
          onProgress(20 + (count / savedPrismLibs.length) * 70, `Mounted ${count} unique DB libs...`);
        }
      }
      log(`Mounted ${count} unique, deduplicated 1.20.1 libraries from IndexedDB!`, "glfw");
    }

    // 4. If Prism libraries weren't in IndexedDB yet, fetch from Mojang CDN
    if (savedPrismLibs.length < 20) {
      log("Querying Mojang Piston-Meta CDN for remaining 1.20.1 libraries...", "net");
      const manifestRes = await fetch(MOJANG_VERSION_MANIFEST_URL);
      const manifestJson = await manifestRes.json();
      const v1201Entry = manifestJson.versions.find(v => v.id === "1.20.1");
      if (!v1201Entry) throw new Error("Could not find 1.20.1 in Mojang version manifest");

      const versionRes = await fetch(v1201Entry.url);
      const versionData = await versionRes.json();

      const downloadQueue = [];
      for (const libEntry of versionData.libraries) {
        const artifact = libEntry.downloads?.artifact;
        if (!artifact || !artifact.url) continue;
        const fileName = artifact.path.split("/").pop();
        if (!isValid1201LibraryJar(fileName, mode)) continue;
        const artifactKey = getArtifactKey(fileName);
        if (!mountedFileNames.has(fileName) && !mountedArtifactKeys.has(artifactKey)) {
          mountedFileNames.add(fileName);
          mountedArtifactKeys.add(artifactKey);
          downloadQueue.push({ url: artifact.url, name: fileName });
        }
      }

      if (mode.startsWith("forge")) {
        for (const forgeUrl of FORGE_1201_MAVEN_LIBS) {
          const fileName = forgeUrl.split("/").pop();
          const artifactKey = getArtifactKey(fileName);
          if (!mountedFileNames.has(fileName) && !mountedArtifactKeys.has(artifactKey)) {
            mountedFileNames.add(fileName);
            mountedArtifactKeys.add(artifactKey);
            downloadQueue.push({ url: forgeUrl, name: fileName });
          }
        }
      }

      log(`Resolving ${downloadQueue.length} libraries (auto-saving to IndexedDB)...`, "net");
      let completed = 0;
      const CONCURRENCY = 6;
      const queueCopy = [...downloadQueue];

      async function worker(self) {
        while (queueCopy.length > 0) {
          const item = queueCopy.shift();
          if (!item) break;
          try {
            const bytes = await self.#fetchSmart(item.url, item.name, log);
            const mountName = `/str/libs_${item.name}`;
            self.#mountJarToCheerpJ(mountName, bytes, item.name, log);
            mountedPaths.push(mountName);
          } catch (err) {
            log(`Skipped optional lib ${item.name}`, "warn");
          }
          completed++;
          const pct = 25 + Math.round((completed / downloadQueue.length) * 65);
          onProgress(pct, `Libs: ${completed}/${downloadQueue.length} (${item.name})`);
        }
      }

      const workers = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        workers.push(worker(this));
      }
      await Promise.all(workers);
    }

    log(`Successfully mounted ${mountedPaths.length} total 1.20.1 + LWJGL 3.3.1 libraries!`, "glfw");
    return mountedPaths;
  }

  async run1201({ mode, username, onProgress, log }) {
    if (this.#isRunning) throw new Error("Instance is already running.");
    this.#isRunning = true;

    const modClasspaths = [];
    const savedMods = await this.#storageDB.getAllEntries("mods");
    if (savedMods.length > 0) {
      log(`Mounting ${savedMods.length} saved mod(s) from IndexedDB...`, "glfw");
      const modManifestNames = [];
      for (const mod of savedMods) {
        const strPath = `/str/mod_${mod.name}`;
        this.#mountJarToCheerpJ(strPath, new Uint8Array(mod.bytes), mod.name, log);
        modClasspaths.push(strPath);
        modManifestNames.push(mod.name);
        log(`Mounted Mod from DB: ${mod.name}`, "info");
      }
      const listBytes = new TextEncoder().encode(modManifestNames.join("\n"));
      cheerpOSAddStringFile("/str/mods_list.txt", listBytes);
    }

    const libPaths = await this.#resolveAndMountLibraries({
      mode,
      onProgress,
      log
    });

    const fullClasspath = [...libPaths, ...modClasspaths].join(":");
    onProgress(95, "Starting JVM Main Thread...");

    const rect = this.#canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || 854));
    const height = Math.max(1, Math.round(rect.height || 480));
    this.#canvas.width = width;
    this.#canvas.height = height;
    window.lwjglCanvasElement = this.#canvas;

    log("Worlds & Saves are automatically persisted in IndexedDB at /files/game/saves", "glfw");

    if (mode === "vanilla") {
      log("Launching Vanilla 1.20.1: net.minecraft.client.main.Main", "glfw");
      onProgress(100, "Running Vanilla 1.20.1");
      return await cheerpjRunMain(
        "net.minecraft.client.main.Main",
        fullClasspath,
        "--username", username,
        "--version", "1.20.1",
        "--gameDir", "/files/game",
        "--assetsDir", "/files/assets",
        "--assetIndex", "5",
        "--uuid", "00000000-0000-0000-0000-000000000000",
        "--accessToken", "0",
        "--userType", "legacy",
        "--versionType", "release",
        "--width", String(width),
        "--height", String(height)
      );
    } else if (mode === "forge-bootstrap") {
      log("Launching Forge 1.20.1 via cpw.mods.bootstraplauncher.BootstrapLauncher...", "glfw");
      onProgress(100, "Running Forge 1.20.1 (Bootstrap)");
      return await cheerpjRunMain(
        "cpw.mods.bootstraplauncher.BootstrapLauncher",
        fullClasspath,
        "--launchTarget", "forgeclient",
        "--fml.forgeVersion", "47.4.28",
        "--fml.mcVersion", "1.20.1",
        "--fml.forgeGroup", "net.minecraftforge",
        "--fml.mcpVersion", "20230612.114412",
        "--username", username,
        "--version", "1.20.1-forge-47.4.28",
        "--gameDir", "/files/game",
        "--assetsDir", "/files/assets",
        "--assetIndex", "5",
        "--uuid", "00000000-0000-0000-0000-000000000000",
        "--accessToken", "0",
        "--userType", "legacy",
        "--versionType", "release",
        "--width", String(width),
        "--height", String(height)
      );
    } else {
      log("Launching Forge 1.20.1 Unified Classpath Mode via StupidForgeLauncher...", "glfw");
      onProgress(100, "Running Forge 1.20.1 (Unified)");
      return await cheerpjRunMain(
        "StupidForgeLauncher",
        fullClasspath,
        "--username", username,
        "--version", "1.20.1-forge-47.4.28",
        "--gameDir", "/files/game",
        "--assetsDir", "/files/assets",
        "--assetIndex", "5",
        "--uuid", "00000000-0000-0000-0000-000000000000",
        "--accessToken", "0",
        "--userType", "legacy",
        "--versionType", "Forge",
        "--width", String(width),
        "--height", String(height)
      );
    }
  }
}
