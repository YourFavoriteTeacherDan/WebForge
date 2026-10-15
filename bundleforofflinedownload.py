import os
import base64
import json
import re
import subprocess
import shutil

def try_compile_java_sources(root_dir):
    """
    If javac and jar are available (e.g., in GitHub Codespaces or Actions),
    automatically compiles StupidForgeLauncher.java and com.cucuzacu.netlib.*
    into minecraftforgelib.jar so Java 17 changes take effect automatically.
    """
    if not shutil.which("javac") or not shutil.which("jar"):
        print("[Bundler] javac/jar not found in PATH; skipping Java recompilation.")
        return

    src_dir = os.path.join(root_dir, "src")
    netlib_src_dir = os.path.join(src_dir, "netlib")
    build_dir = os.path.join(root_dir, ".build_classes")

    if not os.path.exists(src_dir):
        return

    os.makedirs(build_dir, exist_ok=True)
    java_files = []

    for dirpath, _, filenames in os.walk(src_dir):
        for f in filenames:
            if f.endswith(".java"):
                java_files.append(os.path.join(dirpath, f))

    if not java_files:
        return

    print(f"[Bundler] Compiling {len(java_files)} Java source files for Java 17 compatibility...")
    cp_jars = [
        os.path.join(root_dir, j)
        for j in os.listdir(root_dir)
        if j.endswith(".jar")
    ]
    classpath = os.pathsep.join(cp_jars + [src_dir, netlib_src_dir])

    cmd = ["javac", "--release", "8", "-cp", classpath, "-d", build_dir] + java_files
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("[Bundler] javac warning (continuing with existing JARs):", res.stderr)
        shutil.rmtree(build_dir, ignore_errors=True)
        return

    out_jar = os.path.join(root_dir, "minecraftforgelib.jar")
    subprocess.run(["jar", "uf", out_jar, "-C", build_dir, "."], check=False)
    shutil.rmtree(build_dir, ignore_errors=True)
    print("[Bundler] Successfully updated minecraftforgelib.jar with latest NetLib & StupidForgeLauncher!")


def generate_offline_bundle():
    root_dir = os.getcwd()
    try_compile_java_sources(root_dir)

    index_path = os.path.join(root_dir, "index.html")
    mc_web_path = os.path.join(root_dir, "minecraft-web.js")
    natives_dir = os.path.join(root_dir, "natives")

    with open(index_path, "r", encoding="utf-8") as f:
        html_content = f.read()

    mc_web_content = ""
    if os.path.exists(mc_web_path):
        with open(mc_web_path, "r", encoding="utf-8") as f:
            mc_web_content = f.read()

    mc_web_content = mc_web_content.replace("import.meta.url", '"http://offline.local/minecraft-web.js"')

    lwjgl_js_content = "export default {};"
    netlib_js_content = "export default {};"

    lwjgl_path = os.path.join(natives_dir, "lwjgl.js")
    if not os.path.exists(lwjgl_path):
        lwjgl_path = os.path.join(natives_dir, "lwjgl")
    if os.path.exists(lwjgl_path):
        with open(lwjgl_path, "r", encoding="utf-8") as f:
            lwjgl_js_content = f.read()

    netlib_path = os.path.join(natives_dir, "netlib.js")
    if os.path.exists(netlib_path):
        with open(netlib_path, "r", encoding="utf-8") as f:
            netlib_js_content = f.read()

    offline_files = []

    if os.path.exists(natives_dir):
        for fname in sorted(os.listdir(natives_dir)):
            fpath = os.path.join(natives_dir, fname)
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("utf-8")
                offline_files.append({
                    "path": f"/str/{fname}",
                    "data": b64
                })

    ignored_files = {
        "index.html",
        "webforge_offline.html",
        "minecraft-web.js",
        "lwjgl-2.9.0.jar",
        "lwjgl_util-2.9.0.jar",
        "mc.jar"
    }
    ignored_exts = {".py", ".html", ".md"}

    for item in sorted(os.listdir(root_dir)):
        item_path = os.path.join(root_dir, item)
        if item in ignored_files or item == "natives" or item.startswith("."):
            continue
        if os.path.isfile(item_path):
            ext = os.path.splitext(item)[1].lower()
            if ext in ignored_exts:
                continue
            with open(item_path, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("utf-8")
            offline_files.append({
                "path": f"/str/{item}",
                "data": b64
            })

    files_json = json.dumps(offline_files)
    mc_web_json = json.dumps(mc_web_content)
    lwjgl_js_json = json.dumps(lwjgl_js_content)
    netlib_js_json = json.dumps(netlib_js_content)

    injected_module_bootstrap = f"""
      const OriginalURL = window.URL;
      window.URL = class extends OriginalURL {{
        constructor(url, base) {{
          let safeBase = base;
          if (!safeBase || (typeof safeBase === "string" && (safeBase.startsWith("blob:") || safeBase.includes("null")))) {{
            safeBase = "http://offline.local/";
          }}
          try {{
            super(url, safeBase);
          }} catch (e) {{
            super(url, "http://offline.local/");
          }}
        }}
      }};
      Object.assign(window.URL, OriginalURL);

      function base64ToUint8Array(base64) {{
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {{
          bytes[i] = binaryString.charCodeAt(i);
        }}
        return bytes;
      }}

      const OFFLINE_FILES = {files_json};
      window.__OFFLINE_CACHE__ = new Map();

      for (const file of OFFLINE_FILES) {{
        const bytes = base64ToUint8Array(file.data);
        const filename = file.path.split("/").pop();
        window.__OFFLINE_CACHE__.set(file.path, bytes);
        window.__OFFLINE_CACHE__.set(filename, bytes);
      }}

      const originalFetch = window.fetch;
      window.fetch = async function(input, init) {{
        const urlStr = typeof input === "string" ? input : (input && input.url ? input.url : String(input));
        for (const [key, bytes] of window.__OFFLINE_CACHE__.entries()) {{
          if (urlStr.endsWith("/" + key) || urlStr === key) {{
            return new Response(bytes, {{
              status: 200,
              headers: {{
                "Content-Type": "application/octet-stream",
                "Content-Length": bytes.byteLength.toString()
              }}
            }});
          }}
        }}
        return originalFetch.apply(this, arguments);
      }};

      async function importInlineModule(codeStr) {{
        const blob = new Blob([codeStr], {{ type: "application/javascript" }});
        const blobUrl = OriginalURL.createObjectURL(blob);
        return await import(blobUrl);
      }}

      const minecraftWebModule = await importInlineModule({mc_web_json});
      const MinecraftClient = minecraftWebModule.default || minecraftWebModule;

      const lwjglModule = await importInlineModule({lwjgl_js_json});
      const lwjglNatives = lwjglModule.default || lwjglModule;

      const netlibModule = await importInlineModule({netlib_js_json});
      const netlibNatives = netlibModule.default || netlibModule;
"""

    # Replace static ES module imports with inline Blob module loaders
    html_content = re.sub(
        r'import\s+MinecraftClient\s+from\s+["\']\./minecraft-web\.js["\'];?\s*'
        r'import\s+lwjglNatives\s+from\s+["\']\./natives/lwjgl(?:\.js)?["\'];?\s*'
        r'import\s+netlibNatives\s+from\s+["\']\./natives/netlib\.js["\'];?',
        injected_module_bootstrap,
        html_content
    )

    html_content = html_content.replace(
        'const nativesPath = `/app${new URL("natives", import.meta.url).pathname}`;',
        'const nativesPath = "/str";'
    )

    post_init_mount = """
        for (const file of OFFLINE_FILES) {
          const bytes = window.__OFFLINE_CACHE__.get(file.path);
          if (bytes) cheerpOSAddStringFile(file.path, bytes);
        }
"""
    html_content = html_content.replace(
        "MinecraftClient.register();",
        f"{post_init_mount}\n        MinecraftClient.register();"
    )

    out_path = os.path.join(root_dir, "webforge_offline.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    print(f"[Bundler] Generated standalone 1.20.1 offline HTML bundle: {out_path}")

if __name__ == "__main__":
    generate_offline_bundle()
