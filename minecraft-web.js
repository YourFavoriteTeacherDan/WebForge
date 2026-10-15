/**
 * WebForge 1.20.1 Client & Persistent IndexedDB Dependency Engine
 *
 * 1. Stores your Prism Launcher `libraries/` folder and `mods/` permanently in IndexedDB
 *    (`WebForge1201StorageDB`), so you only ever select them once.
 * 2. Stores all Minecraft worlds, saves, options.txt, and configs in CheerpJ's
 *    persistent IndexedDB `/files/game` mount (`cjFS_/files`).
 * 3. Eliminates `repo1.maven.org` CORS failures by checking IndexedDB -> Local Repo ->
 *    `libraries.minecraft.net` -> Automatic CORS Proxy Fallbacks.
 */

const MOJANG_VERSION_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

// Hosted on Mojang's official libraries.minecraft.net CDN (replaces blocked repo1.maven.org links)
const LWJGL3_CORE_JARS = [
  "https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar",
  "https://libraries.minecraft.net/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar"
];

// Forge 1.20.1 (47.4.28) Required Libraries
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
  "https://maven.minecraftforge.net/net/jodah/typetools/0.6.3/typetools-0.6.3.jar",
  "https://maven.minecraftforge.net/net/minecrell/terminalconsoleappender/1.3.0/terminalconsoleappender-1.3.0.jar",
  "https://maven.minecraftforge.net/org/openjdk/nashorn/nashorn-core/15.4/nashorn-core-15.4.jar"
];

class PersistentStorageDB {
  #dbPromise = null;

  constructor() {
    this.#dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("WebForge1201StorageDB", 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("prism_libs")) {
          db.createObjectStore("prism_libs"); // key: filename -> Uint8Array
        }
        if (!db.objectStoreNames.contains("cloud_libs")) {
          db.createObjectStore("cloud_libs"); // key: filename -> Uint8Array
        }
        if (!db.objectStoreNames.contains("mods")) {
          db.createObjectStore("mods"); // key: filename -> Uint8Array
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

  /**
   * Saves all valid 1.20.1 JARs from the user's Prism Launcher `libraries/` folder
   * permanently into IndexedDB so they never need to be re-uploaded or fetched.
   */
  async savePrismLibsToDB(fileList, onProgress, log) {
    const jarFiles = fileList.filter(f =>
      f.name.endsWith(".jar") &&
      !f.name.includes("2.9.") &&
      !f.name.includes("-natives-") &&
      !f.name.includes("macos") &&
      !f.name.includes("windows")
    );
    log(`Saving ${jarFiles.length} JARs from Prism 'libraries/' folder into IndexedDB...`, "glfw");
    let count = 0;
    for (const file of jarFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.#storageDB.set("prism_libs", file.name, bytes);
      count++;
      if (count % 10 === 0 || count === jarFiles.length) {
        const pct = Math.round((count / jarFiles.length) * 100);
        onProgress?.(pct, `Saving Prism Libs to DB: ${count}/${jarFiles.length}`);
      }
    }
    log(`Permanently saved ${count} Prism libraries into IndexedDB! They will now auto-mount on every boot.`, "info");
  }

  /**
   * Saves uploaded Mod JARs permanently into IndexedDB.
   */
  async saveModsToDB(fileList, log) {
    const jarFiles = fileList.filter(f => f.name.endsWith(".jar") || f.name.endsWith(".zip"));
    for (const file of jarFiles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.#storageDB.set("mods", file.name, bytes);
      log(`Saved Mod '${file.name}' (${(bytes.byteLength / 1024).toFixed(1)} KB) permanently in IndexedDB!`, "info");
    }
  }

  /**
   * Smart CORS-Proof Library Resolver:
   * 1. Checks IndexedDB `prism_libs` and `cloud_libs`
   * 2. Checks your GitHub Repo root (`./<fileName>` and `./libs/<fileName>`)
   * 3. Tries direct CDN URL (`libraries.minecraft.net` / `maven.minecraftforge.net`)
   * 4. Falls back to CORS proxies (`corsproxy.io` / `allorigins.win`) if a Maven server blocks CORS
   */
  async #fetchSmart(remoteUrl, fileName, log) {
    // 1. Check IndexedDB Prism Libs or Cloud Libs first
    const fromPrism = await this.#storageDB.get("prism_libs", fileName);
    if (fromPrism && fromPrism.byteLength > 0) return fromPrism;

    const fromCloud = await this.#storageDB.get("cloud_libs", fileName);
    if (fromCloud && fromCloud.byteLength > 0) return fromCloud;

    // 2. Check if the user uploaded the file directly into the GitHub repo root or ./libs/
    const localCandidates = [
      new URL(fileName, import.meta.url).href,
      new URL(`libs/${fileName}`, import.meta.url).href
    ];
    for (const localUrl of localCandidates) {
      try {
        const res = await fetch(localUrl);
        if (res.ok) {
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (bytes.byteLength > 100 && bytes[0] === 0x50 && bytes[1] === 0x4B) { // Valid ZIP/JAR 'PK' header
            await this.#storageDB.set("cloud_libs", fileName, bytes);
            return bytes;
          }
        }
      } catch (_) {}
    }

    // 3. Try direct CDN URL + CORS-Proxy fallbacks
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

  async #resolveAndMountLibraries({ mode, onProgress, log }) {
    const mountedPaths = [];
    const mountedFileNames = new Set();

    // 1. Mount Base Client, StupidForgeLauncher wrapper, & Forge Universal JARs from Repo Root
    onProgress(5, "Mounting base 1.20.1 JARs...");
    try {
      const wrapperBytes = await this.#fetchSmart(
        new URL("minecraftforgelib.jar", import.meta.url).href,
        "minecraftforgelib.jar",
        log
      );
      cheerpOSAddStringFile("/str/minecraftforgelib.jar", wrapperBytes);
      mountedPaths.push("/str/minecraftforgelib.jar");
    } catch (_) {}

    log("Mounting minecraft-1.20.1-client.jar...", "net");
    const clientBytes = await this.#fetchSmart(
      new URL("minecraft-1.20.1-client.jar", import.meta.url).href,
      "minecraft-1.20.1-client.jar",
      log
    );
    cheerpOSAddStringFile("/str/minecraft-1.20.1-client.jar", clientBytes);
    mountedFileNames.add("minecraft-1.20.1-client.jar");
    log(`Mounted /str/minecraft-1.20.1-client.jar (${(clientBytes.byteLength / 1048576).toFixed(2)} MB)`, "info");

    if (mode.startsWith("forge")) {
      log("Mounting forge-1.20.1-47.4.28-universal.jar...", "net");
      const forgeBytes = await this.#fetchSmart(
        new URL("forge-1.20.1-47.4.28-universal.jar", import.meta.url).href,
        "forge-1.20.1-47.4.28-universal.jar",
        log
      );
      cheerpOSAddStringFile("/str/forge-1.20.1-47.4.28-universal.jar", forgeBytes);
      mountedPaths.push("/str/forge-1.20.1-47.4.28-universal.jar");
      mountedFileNames.add("forge-1.20.1-47.4.28-universal.jar");
      log(`Mounted /str/forge-1.20.1-47.4.28-universal.jar (${(forgeBytes.byteLength / 1048576).toFixed(2)} MB)`, "info");
    }

    // 2. Check if user has saved their Prism `libraries/` folder in IndexedDB
    const savedPrismLibs = await this.#storageDB.getAllEntries("prism_libs");
    if (savedPrismLibs.length > 0) {
      log(`Loading ${savedPrismLibs.length} libraries directly from Persistent IndexedDB...`, "glfw");
      let count = 0;
      for (const entry of savedPrismLibs) {
        if (mountedFileNames.has(entry.name)) continue;
        const vPath = `/str/libs_${entry.name}`;
        cheerpOSAddStringFile(vPath, entry.bytes);
        mountedPaths.push(vPath);
        mountedFileNames.add(entry.name);
        count++;
        if (count % 15 === 0 || count === savedPrismLibs.length) {
          onProgress(15 + (count / savedPrismLibs.length) * 75, `Mounted ${count}/${savedPrismLibs.length} DB libs...`);
        }
      }
    }

    // 3. Ensure all 7 LWJGL 3.3.1 Core JARs are mounted (from DB, Repo, or Mojang CDN)
    onProgress(20, "Mounting LWJGL 3.3.1 JARs...");
    for (const lwjglUrl of LWJGL3_CORE_JARS) {
      const fileName = lwjglUrl.split("/").pop();
      if (mountedFileNames.has(fileName)) continue;
      try {
        const bytes = await this.#fetchSmart(lwjglUrl, fileName, log);
        const vPath = `/str/libs_${fileName}`;
        cheerpOSAddStringFile(vPath, bytes);
        mountedPaths.unshift(vPath); // Keep LWJGL 3.3.1 at the front of the classpath
        mountedFileNames.add(fileName);
        log(`Mounted LWJGL 3 JAR: ${vPath} (${(bytes.byteLength / 1024).toFixed(1)} KB)`, "glfw");
      } catch (e) {
        log(`Warning fetching ${fileName}: ${e.message}`, "warn");
      }
    }

    // 4. If Prism libraries weren't in IndexedDB yet, fetch remaining 1.20.1 libraries from Mojang CDN
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
        if (artifact.path.includes("-natives-") || artifact.path.includes("macos") || artifact.path.includes("windows")) {
          continue;
        }
        const fileName = artifact.path.split("/").pop();
        if (!mountedFileNames.has(fileName)) {
          mountedFileNames.add(fileName);
          downloadQueue.push({ url: artifact.url, name: fileName });
        }
      }

      if (mode.startsWith("forge")) {
        for (const forgeUrl of FORGE_1201_MAVEN_LIBS) {
          const fileName = forgeUrl.split("/").pop();
          if (!mountedFileNames.has(fileName)) {
            mountedFileNames.add(fileName);
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
            cheerpOSAddStringFile(mountName, bytes);
            mountedPaths.push(mountName);
          } catch (err) {
            log(`Skipped optional/blocked lib ${item.name} (Tip: use Prism 'libraries/' folder picker above to load locally)`, "warn");
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

    mountedPaths.push("/str/minecraft-1.20.1-client.jar");
    log(`Successfully mounted ${mountedPaths.length} total 1.20.1 + LWJGL 3.3.1 libraries!`, "glfw");
    return mountedPaths;
  }

  async run1201({ mode, username, onProgress, log }) {
    if (this.#isRunning) throw new Error("Instance is already running.");
    this.#isRunning = true;

    // 1. Load all saved Mods from IndexedDB and mount to /str/mod_<name>
    const modClasspaths = [];
    const savedMods = await this.#storageDB.getAllEntries("mods");
    if (savedMods.length > 0) {
      log(`Mounting ${savedMods.length} saved mod(s) from IndexedDB...`, "glfw");
      const modManifestNames = [];
      for (const mod of savedMods) {
        const strPath = `/str/mod_${mod.name}`;
        cheerpOSAddStringFile(strPath, mod.bytes);
        modClasspaths.push(strPath);
        modManifestNames.push(mod.name);
        log(`Mounted Mod from DB: ${mod.name}`, "info");
      }
      // Write a manifest list in /str/mods_list.txt so StupidForgeLauncher can copy them into /files/game/mods/
      const listBytes = new TextEncoder().encode(modManifestNames.join("\n"));
      cheerpOSAddStringFile("/str/mods_list.txt", listBytes);
    }

    // 2. Resolve and mount all 1.20.1 & LWJGL 3.3.1 libraries
    const libPaths = await this.#resolveAndMountLibraries({
      mode,
      onProgress,
      log
    });

    const fullClasspath = [...modClasspaths, ...libPaths].join(":");
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
      log("Launching Forge 1.20.1 Unified Classpath Mode...", "glfw");
      onProgress(100, "Running Forge 1.20.1 (Unified)");
      return await cheerpjRunMain(
        "net.minecraft.client.main.Main",
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
