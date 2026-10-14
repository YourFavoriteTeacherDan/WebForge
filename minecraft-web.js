/**
 * WebForge 1.20.1 Client & Dependency Engine
 * Explicitly fetches and mounts LWJGL 3.3.1 JARs, Mojang 1.20.1 libraries,
 * and Forge 47.4.28 Maven dependencies into CheerpJ's /str/ memory filesystem.
 */

const MOJANG_VERSION_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

// Guaranteed LWJGL 3.3.1 Core & Module JARs (replaces lwjgl-2.9.0.jar)
const LWJGL3_CORE_JARS = [
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar",
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1.jar",
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1.jar",
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1.jar",
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1.jar",
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1.jar",
  "https://repo1.maven.org/maven2/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1.jar"
];

// Forge 1.20.1 (47.4.28) Required Maven Libraries
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
  "https://repo1.maven.org/maven2/org/ow2/asm/asm/9.5/asm-9.5.jar",
  "https://repo1.maven.org/maven2/org/ow2/asm/asm-commons/9.5/asm-commons-9.5.jar",
  "https://repo1.maven.org/maven2/org/ow2/asm/asm-tree/9.5/asm-tree-9.5.jar",
  "https://repo1.maven.org/maven2/org/ow2/asm/asm-util/9.5/asm-util-9.5.jar",
  "https://repo1.maven.org/maven2/org/ow2/asm/asm-analysis/9.5/asm-analysis-9.5.jar",
  "https://repo1.maven.org/maven2/com/electronwill/night-config/core/3.6.4/core-3.6.4.jar",
  "https://repo1.maven.org/maven2/com/electronwill/night-config/toml/3.6.4/toml-3.6.4.jar",
  "https://repo1.maven.org/maven2/org/apache/maven/maven-artifact/3.8.5/maven-artifact-3.8.5.jar",
  "https://repo1.maven.org/maven2/net/jodah/typetools/0.6.3/typetools-0.6.3.jar",
  "https://repo1.maven.org/maven2/net/minecrell/terminalconsoleappender/1.3.0/terminalconsoleappender-1.3.0.jar",
  "https://repo1.maven.org/maven2/org/openjdk/nashorn/nashorn-core/15.4/nashorn-core-15.4.jar"
];

class LibCacheDB {
  #dbPromise = null;

  constructor() {
    this.#dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("WebForge1201LibCache", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("jars")) {
          db.createObjectStore("jars");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async get(key) {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("jars", "readonly");
      const req = tx.objectStore("jars").get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async set(key, uint8Array) {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("jars", "readwrite");
      const req = tx.objectStore("jars").put(uint8Array, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async clear() {
    const db = await this.#dbPromise;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("jars", "readwrite");
      const req = tx.objectStore("jars").clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
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
  #cacheDB;
  #isRunning = false;

  constructor() {
    super();
    this.#cacheDB = new LibCacheDB();

    const shadowRoot = this.attachShadow({ mode: "open" });
    shadowRoot.appendChild(template.content.cloneNode(true));

    this.#canvas = shadowRoot.querySelector("canvas");
    this.#canvas.width = 854;
    this.#canvas.height = 480;
    window.lwjglCanvasElement = this.#canvas;

    this.#display = shadowRoot.querySelector(".display");
    if (typeof cheerpjCreateDisplay === "function") {
      cheerpjCreateDisplay(-1, -1, this.#display);
    }

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

  async clearLibraryCache() {
    await this.#cacheDB.clear();
  }

  async #fetchWithCache(url, cacheKey) {
    let bytes = await this.#cacheDB.get(cacheKey);
    if (bytes && bytes.byteLength > 0) {
      return bytes;
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    const buf = await res.arrayBuffer();
    bytes = new Uint8Array(buf);
    await this.#cacheDB.set(cacheKey, bytes);
    return bytes;
  }

  async #ensureDirectories(paths) {
    if (!window.cjLib) return;
    try {
      const Files = await window.cjLib.java.nio.file.Files;
      const Paths = await window.cjLib.java.nio.file.Paths;
      for (const p of paths) {
        const dirPath = await Paths.get(p);
        await Files.createDirectories(dirPath);
      }
    } catch (e) {
      console.warn("Directory creation warning:", e);
    }
  }

  async #resolveAndMountLibraries({ mode, localLibFiles, onProgress, log }) {
    const mountedPaths = [];
    const mountedFileNames = new Set();

    // 1. Explicitly Mount All 7 LWJGL 3.3.1 JARs First (Completely replaces lwjgl-2.9.0.jar)
    onProgress(3, "Fetching LWJGL 3.3.1 JARs...");
    log("Fetching & mounting LWJGL 3.3.1 core & GLFW/OpenGL/STB JARs...", "glfw");
    for (const lwjglUrl of LWJGL3_CORE_JARS) {
      const fileName = lwjglUrl.split("/").pop();
      const bytes = await this.#fetchWithCache(lwjglUrl, `lwjgl3:${fileName}`);
      const vPath = `/str/libs_${fileName}`;
      cheerpOSAddStringFile(vPath, bytes);
      mountedPaths.push(vPath);
      mountedFileNames.add(fileName);
      log(`Mounted LWJGL 3 JAR: ${vPath} (${(bytes.byteLength / 1024).toFixed(1)} KB)`, "glfw");
    }

    // 2. Mount Base Client & Forge Universal JARs from Repo Root
    onProgress(10, "Mounting base 1.20.1 JARs...");
    log("Fetching minecraft-1.20.1-client.jar from repository...", "net");
    const clientBytes = await this.#fetchWithCache(
      new URL("minecraft-1.20.1-client.jar", import.meta.url).href,
      "repo:minecraft-1.20.1-client.jar"
    );
    cheerpOSAddStringFile("/str/minecraft-1.20.1-client.jar", clientBytes);
    log(`Mounted /str/minecraft-1.20.1-client.jar (${(clientBytes.byteLength / 1048576).toFixed(2)} MB)`, "info");

    if (mode.startsWith("forge")) {
      log("Fetching forge-1.20.1-47.4.28-universal.jar from repository...", "net");
      const forgeBytes = await this.#fetchWithCache(
        new URL("forge-1.20.1-47.4.28-universal.jar", import.meta.url).href,
        "repo:forge-1.20.1-47.4.28-universal.jar"
      );
      cheerpOSAddStringFile("/str/forge-1.20.1-47.4.28-universal.jar", forgeBytes);
      mountedPaths.push("/str/forge-1.20.1-47.4.28-universal.jar");
      log(`Mounted /str/forge-1.20.1-47.4.28-universal.jar (${(forgeBytes.byteLength / 1048576).toFixed(2)} MB)`, "info");
    }

    // 3. If user selected their local Prism Launcher libraries/ folder, mount from disk
    if (localLibFiles && localLibFiles.length > 0) {
      const jarFiles = localLibFiles.filter(f =>
        f.name.endsWith(".jar") &&
        !f.name.includes("2.9.") &&
        !f.name.includes("-natives-") &&
        !f.name.includes("macos") &&
        !f.name.includes("windows") &&
        !mountedFileNames.has(f.name)
      );
      log(`Mounting ${jarFiles.length} JARs from local Prism libraries folder...`, "glfw");
      let count = 0;
      for (const file of jarFiles) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const vPath = `/str/lib_${count}_${file.name}`;
        cheerpOSAddStringFile(vPath, bytes);
        mountedPaths.push(vPath);
        mountedFileNames.add(file.name);
        count++;
        if (count % 10 === 0) {
          onProgress(15 + (count / jarFiles.length) * 75, `Mounted ${count}/${jarFiles.length} local libs...`);
        }
      }
      mountedPaths.push("/str/minecraft-1.20.1-client.jar");
      return mountedPaths;
    }

    // 4. Otherwise, Auto-Fetch Mojang 1.20.1 Official Manifest & Libraries via CDN
    log("Querying Mojang Piston-Meta CDN for 1.20.1 dependency manifest...", "net");
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
        downloadQueue.push({
          url: artifact.url,
          name: fileName,
          path: artifact.path
        });
      }
    }

    if (mode.startsWith("forge")) {
      for (const forgeUrl of FORGE_1201_MAVEN_LIBS) {
        const fileName = forgeUrl.split("/").pop();
        if (!mountedFileNames.has(fileName)) {
          mountedFileNames.add(fileName);
          downloadQueue.push({
            url: forgeUrl,
            name: fileName,
            path: `forge/${fileName}`
          });
        }
      }
    }

    log(`Resolving ${downloadQueue.length} remaining 1.20.1 libraries (Cached in IndexedDB)...`, "net");

    let completed = 0;
    const CONCURRENCY = 8;
    const queueCopy = [...downloadQueue];

    async function worker(self) {
      while (queueCopy.length > 0) {
        const item = queueCopy.shift();
        if (!item) break;
        try {
          const bytes = await self.#fetchWithCache(item.url, `lib:${item.path}`);
          const mountName = `/str/libs_${item.name}`;
          cheerpOSAddStringFile(mountName, bytes);
          mountedPaths.push(mountName);
        } catch (err) {
          log(`Warning: Could not fetch library ${item.name}: ${err.message}`, "warn");
        }
        completed++;
        const pct = 15 + Math.round((completed / downloadQueue.length) * 75);
        onProgress(pct, `Libs: ${completed}/${downloadQueue.length} (${item.name})`);
      }
    }

    const workers = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(worker(this));
    }
    await Promise.all(workers);

    mountedPaths.push("/str/minecraft-1.20.1-client.jar");
    log(`Successfully mounted ${mountedPaths.length} total 1.20.1 + LWJGL 3.3.1 libraries into /str/!`, "glfw");
    return mountedPaths;
  }

  async run1201({ mode, username, localLibFiles, modFiles, onProgress, log }) {
    if (this.#isRunning) throw new Error("Instance is already running.");
    this.#isRunning = true;

    await this.#ensureDirectories([
      "/files/game",
      "/files/game/mods",
      "/files/game/config",
      "/files/game/resourcepacks",
      "/files/assets",
      "/files/assets/indexes",
      "/files/assets/objects"
    ]);

    const modClasspaths = [];
    if (modFiles && modFiles.length > 0) {
      log(`Injecting ${modFiles.length} user mod(s)...`, "glfw");
      const Files = await window.cjLib.java.nio.file.Files;
      const Paths = await window.cjLib.java.nio.file.Paths;
      const StandardCopyOption = await window.cjLib.java.nio.file.StandardCopyOption;

      for (const file of modFiles) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const strPath = `/str/mod_${file.name}`;
        cheerpOSAddStringFile(strPath, bytes);
        modClasspaths.push(strPath);

        const src = await Paths.get(strPath);
        const dst = await Paths.get(`/files/game/mods/${file.name}`);
        await Files.copy(src, dst, [StandardCopyOption.REPLACE_EXISTING]);
        log(`Uploaded mod to /files/game/mods/${file.name}`, "info");
      }
    }

    const libPaths = await this.#resolveAndMountLibraries({
      mode,
      localLibFiles,
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
