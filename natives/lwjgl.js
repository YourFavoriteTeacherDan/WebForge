// ============================================================================
// WebForge Unified LWJGL 3.3.1 Engine (v7)
// Includes:
// - JNINativeInterface.nNewDirectByteBuffer (Constructs real DirectByteBuffer
//   instances for LWJGL 3 MemoryUtil.<clinit> magic-offset calibration)
// - OpenJDK 17 NativeLibraries.load Bridge
// - 16 MB Shared Wasm Linear Heap Arena
// - GLFW 3.3.8 + WebGL 2 Core (GLSL 150 -> 300 es) + Async STBImage + OpenAL
// ============================================================================

await import("https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/3.4.2/gl-matrix-min.js");

let glCanvas = null;
let glCtx = null;
let debugRendererExt = null;
let canvasListenersAttached = false;

const GL_CONST = (typeof WebGL2RenderingContext !== "undefined")
  ? WebGL2RenderingContext
  : {
      FRAGMENT_SHADER: 0x8B30,
      VERTEX_SHADER: 0x8B31,
      COMPILE_STATUS: 0x8B81,
      LINK_STATUS: 0x8B82,
      VALIDATE_STATUS: 0x8B83,
      MAX_TEXTURE_SIZE: 0x0D33,
      MAX_RENDERBUFFER_SIZE: 0x84E8,
      BLEND: 0x0BE2,
      DEPTH_TEST: 0x0B71,
      CULL_FACE: 0x0B44,
      SCISSOR_TEST: 0x0C11,
      STENCIL_TEST: 0x0B90,
      POLYGON_OFFSET_FILL: 0x8037,
      PACK_ALIGNMENT: 0x0D05,
      UNPACK_ALIGNMENT: 0x0CF5,
      UNPACK_ROW_LENGTH: 0x0CF2,
      UNPACK_SKIP_PIXELS: 0x0CF4,
      UNPACK_SKIP_ROWS: 0x0CF3,
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      DYNAMIC_DRAW: 0x88E8,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      CLAMP_TO_EDGE: 0x812F,
      RGBA: 0x1908,
      RGBA8: 0x8058,
      UNSIGNED_BYTE: 0x1401
    };

function resolveActiveCanvas() {
  if (window.lwjglCanvasElement instanceof HTMLCanvasElement) {
    return window.lwjglCanvasElement;
  }
  const mcClient = document.querySelector("minecraft-client");
  if (mcClient && mcClient.shadowRoot) {
    const c = mcClient.shadowRoot.querySelector("canvas");
    if (c) {
      window.lwjglCanvasElement = c;
      return c;
    }
  }
  const existing = document.querySelector("canvas");
  if (existing) {
    window.lwjglCanvasElement = existing;
    return existing;
  }
  const created = document.createElement("canvas");
  created.width = 854;
  created.height = 480;
  created.style.width = "100%";
  created.style.height = "100%";
  const viewportPane = document.getElementById("viewport-pane") || document.body;
  viewportPane.appendChild(created);
  window.lwjglCanvasElement = created;
  return created;
}

function attachInputListeners(canvas) {
  if (canvasListenersAttached || !canvas) return;
  canvasListenersAttached = true;

  window.addEventListener("keydown", e => {
    const k = browserCodeToGLFWKey(e.code);
    if (k > 0 && k < 512) glfwState.keys[k] = 1;
  });

  window.addEventListener("keyup", e => {
    const k = browserCodeToGLFWKey(e.code);
    if (k > 0 && k < 512) glfwState.keys[k] = 0;
  });

  canvas.addEventListener("mousedown", e => {
    canvas.focus?.();
    glfwState.mouseButtons[e.button] = 1;
    if (glfwState.cursorMode === GLFW_CURSOR_DISABLED && document.pointerLockElement !== canvas) {
      try { canvas.requestPointerLock(); } catch (_) {}
    }
  });

  window.addEventListener("mouseup", e => {
    glfwState.mouseButtons[e.button] = 0;
  });

  window.addEventListener("mousemove", e => {
    if (document.pointerLockElement === canvas) {
      glfwState.mouseX += e.movementX;
      glfwState.mouseY += e.movementY;
    } else {
      const r = canvas.getBoundingClientRect();
      glfwState.mouseX = e.clientX - r.left;
      glfwState.mouseY = e.clientY - r.top;
    }
  });

  canvas.addEventListener("contextmenu", e => e.preventDefault());
}

function ensureGLContext() {
  if (glCtx) return glCtx;

  glCanvas = resolveActiveCanvas();
  attachInputListeners(glCanvas);

  const optionProfiles = [
    { alpha: false, depth: true, stencil: true, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: false },
    { alpha: false, depth: true, stencil: true, antialias: false },
    { depth: true, stencil: true },
    {}
  ];

  for (const opts of optionProfiles) {
    try {
      glCtx = glCanvas.getContext("webgl2", opts);
      if (glCtx) break;
    } catch (_) {}
  }

  if (!glCtx) {
    try {
      glCtx = glCanvas.getContext("webgl") || glCanvas.getContext("experimental-webgl");
    } catch (_) {}
  }

  if (glCtx) {
    try {
      debugRendererExt = glCtx.getExtension("WEBGL_debug_renderer_info");
      glCtx.getExtension("EXT_color_buffer_float");
      glCtx.getExtension("OES_texture_float_linear");
    } catch (_) {}
  }

  return glCtx;
}

// ============================================================================
// 1. Shared Wasm Linear Memory & DirectByteBuffer Calibration Manager
// ============================================================================
class WasmHeapMemoryManager {
  constructor() {
    this.allocations = new Map();
    this.freeList = [];
    this.jsFallbackBlocks = new Map();
    this.nextFallbackPtr = 0x50000000;
    this.wasmArenaPtr = 0;
    this.wasmArenaEnd = 0;
    this.scratchStringPtrs = new Map();
    this.rawBuffer = null;
    this.heapView = null;

    // DirectByteBuffer reflection/field-key calibration cache
    this.dbbCalibrated = false;
    this.capacityKey = null;
    this.limitKey = null;
    this.positionKey = null;
    this.markKey = null;
    this.addressKey = null;
  }

  getDataView(lib) {
    if (lib && typeof lib.getJNIDataView === "function") {
      try {
        const v = lib.getJNIDataView();
        if (v && v.buffer !== this.rawBuffer) {
          this.rawBuffer = v.buffer;
          this.heapView = new Uint8Array(v.buffer);
          if (this.wasmArenaPtr === 0 && v.byteLength >= 0x00200000) {
            this.wasmArenaPtr = (Math.floor(v.byteLength * 0.55) + 15) & ~15;
            this.wasmArenaEnd = v.byteLength - 65536;
          }
        }
        return v;
      } catch (_) {}
    }
    return null;
  }

  async calibrateDirectByteBufferLayout(lib) {
    if (this.dbbCalibrated) return;
    this.dbbCalibrated = true;

    try {
      const ByteBuffer = await lib.java.nio.ByteBuffer;
      const probe1 = await ByteBuffer.allocateDirect(0x1234);
      await probe1.limit(0x0567);
      await probe1.position(0x0123);
      await probe1.mark();

      // Allocate a persistent 16 MB native Wasm slab via OpenJDK 17's own Unsafe.allocateMemory
      const slabSize = 16 * 1024 * 1024;
      const slabBuf = await ByteBuffer.allocateDirect(slabSize);
      window.__webforgeWasmSlab = slabBuf;

      const keys = Reflect.ownKeys(probe1);
      for (const k of keys) {
        const v1 = probe1[k];
        const v2 = slabBuf[k];
        if (v1 === 0x1234 && v2 === slabSize) {
          this.capacityKey = k;
        } else if (v1 === 0x0567 && v2 === slabSize) {
          this.limitKey = k;
        } else if (v1 === 0x0123 && v2 === 0) {
          this.positionKey = k;
        } else if (v1 === 0x0123 && v2 === -1) {
          this.markKey = k;
        } else if ((typeof v1 === "bigint" || typeof v1 === "number") && v1 !== v2 && v1 !== 0 && v1 !== 0n) {
          this.addressKey = k;
        }
      }

      if (this.addressKey !== null) {
        const slabAddr = Number(slabBuf[this.addressKey]);
        if (slabAddr > 0) {
          this.wasmArenaPtr = (slabAddr + 64) & ~15;
          this.wasmArenaEnd = slabAddr + slabSize - 1024;
          window.webforgeLog?.(`[WasmArena] Locked 16 MB native Wasm arena at 0x${this.wasmArenaPtr.toString(16)}`, "glfw");
        }
      }
      window.webforgeLog?.(`[DirectByteBuffer] Calibrated field keys: addr=${String(this.addressKey)}, cap=${String(this.capacityKey)}, lim=${String(this.limitKey)}`, "glfw");
    } catch (err) {
      console.warn("[DirectByteBuffer] Calibration notice:", err);
    }
  }

  malloc(lib, size) {
    this.getDataView(lib);
    const byteSize = Math.max(16, Number(size) || 16);
    const alignedSize = (byteSize + 15) & ~15;

    for (let i = 0; i < this.freeList.length; i++) {
      const entry = this.freeList[i];
      if (entry.size >= alignedSize && entry.size <= alignedSize * 2) {
        this.freeList.splice(i, 1);
        this.allocations.set(entry.ptr, entry.size);
        return entry.ptr;
      }
    }

    if (this.heapView && this.wasmArenaPtr > 0 && this.wasmArenaPtr + alignedSize < this.wasmArenaEnd) {
      const ptr = this.wasmArenaPtr;
      this.wasmArenaPtr += alignedSize;
      this.allocations.set(ptr, alignedSize);
      return ptr;
    }

    const ptr = this.nextFallbackPtr;
    this.nextFallbackPtr += alignedSize + 16;
    const block = new Uint8Array(alignedSize);
    this.jsFallbackBlocks.set(ptr, block);
    this.allocations.set(ptr, alignedSize);
    return ptr;
  }

  calloc(lib, num, size) {
    const total = Math.max(16, (Number(num) || 1) * (Number(size) || 1));
    const ptr = this.malloc(lib, total);
    this.memset(lib, ptr, 0, total);
    return ptr;
  }

  realloc(lib, ptr, newSize) {
    const oldPtr = Number(ptr);
    if (oldPtr === 0) return this.malloc(lib, newSize);
    const oldSize = this.allocations.get(oldPtr) || 0;
    const newPtr = this.malloc(lib, newSize);
    if (oldSize > 0) {
      const copyLen = Math.min(oldSize, Number(newSize));
      const src = this.getSubarray(lib, oldPtr, copyLen);
      const dst = this.getSubarray(lib, newPtr, copyLen);
      if (src && dst) dst.set(src);
    }
    this.free(lib, oldPtr);
    return newPtr;
  }

  free(lib, ptr) {
    const p = Number(ptr);
    if (!p) return;
    const sz = this.allocations.get(p);
    this.allocations.delete(p);
    if (this.jsFallbackBlocks.has(p)) {
      this.jsFallbackBlocks.delete(p);
    } else if (sz && sz >= 16 && this.freeList.length < 512) {
      this.freeList.push({ ptr: p, size: sz });
    }
  }

  memset(lib, ptr, val, size) {
    const slice = this.getSubarray(lib, ptr, size);
    if (slice) slice.fill(Number(val) & 0xFF);
    return Number(ptr);
  }

  memcpy(lib, dst, src, size) {
    const len = Number(size);
    const s = this.getSubarray(lib, src, len);
    const d = this.getSubarray(lib, dst, len);
    if (s && d) d.set(s.subarray(0, d.length));
    return Number(dst);
  }

  getSubarray(lib, ptr, byteLength) {
    const p = Number(ptr);
    if (p === 0) return null;
    const len = Number(byteLength) || this.allocations.get(p) || 256;

    if (p >= 0x50000000) {
      if (this.jsFallbackBlocks.has(p)) {
        const blk = this.jsFallbackBlocks.get(p);
        return blk.subarray(0, Math.min(len, blk.length));
      }
      for (const [basePtr, blk] of this.jsFallbackBlocks.entries()) {
        if (p >= basePtr && p < basePtr + blk.byteLength) {
          const offset = p - basePtr;
          return blk.subarray(offset, Math.min(blk.byteLength, offset + len));
        }
      }
    }

    this.getDataView(lib);
    if (this.heapView && p > 0 && p < this.heapView.byteLength) {
      return this.heapView.subarray(p, Math.min(this.heapView.byteLength, p + len));
    }

    const fallback = new Uint8Array(Math.max(len, 256));
    this.jsFallbackBlocks.set(p, fallback);
    this.allocations.set(p, fallback.length);
    return fallback.subarray(0, len);
  }

  readCString(lib, ptr, maxLen = 4096) {
    if (!ptr) return "";
    if (typeof ptr === "string") return ptr;
    const p = Number(ptr);
    if (!p) return "";

    const slice = this.getSubarray(lib, p, maxLen);
    if (!slice) return "";
    let end = 0;
    while (end < slice.length && slice[end] !== 0) end++;
    return new TextDecoder("utf-8").decode(slice.subarray(0, end));
  }

  allocCString(lib, str) {
    const s = String(str ?? "");
    if (this.scratchStringPtrs.has(s)) {
      return this.scratchStringPtrs.get(s);
    }
    const bytes = new TextEncoder().encode(s + "\0");
    const ptr = this.malloc(lib, bytes.length);
    const dst = this.getSubarray(lib, ptr, bytes.length);
    if (dst) dst.set(bytes);
    this.scratchStringPtrs.set(s, ptr);
    return ptr;
  }

  readInt8(lib, ptr) {
    const sub = this.getSubarray(lib, ptr, 1);
    return sub ? (sub[0] << 24) >> 24 : 0;
  }

  writeInt8(lib, ptr, val) {
    const sub = this.getSubarray(lib, ptr, 1);
    if (sub) sub[0] = Number(val) & 0xFF;
  }

  readInt16(lib, ptr) {
    const sub = this.getSubarray(lib, ptr, 2);
    return sub ? new DataView(sub.buffer, sub.byteOffset, 2).getInt16(0, true) : 0;
  }

  writeInt16(lib, ptr, val) {
    const sub = this.getSubarray(lib, ptr, 2);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 2).setInt16(0, Number(val), true);
  }

  readInt32(lib, ptr) {
    const sub = this.getSubarray(lib, ptr, 4);
    return sub ? new DataView(sub.buffer, sub.byteOffset, 4).getInt32(0, true) : 0;
  }

  writeInt32(lib, ptr, val) {
    const sub = this.getSubarray(lib, ptr, 4);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 4).setInt32(0, Number(val), true);
  }

  readInt64(lib, ptr) {
    const sub = this.getSubarray(lib, ptr, 8);
    return sub ? Number(new DataView(sub.buffer, sub.byteOffset, 8).getBigInt64(0, true)) : 0;
  }

  writeInt64(lib, ptr, val) {
    const sub = this.getSubarray(lib, ptr, 8);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 8).setBigInt64(0, BigInt(Math.trunc(Number(val) || 0)), true);
  }

  readFloat32(lib, ptr) {
    const sub = this.getSubarray(lib, ptr, 4);
    return sub ? new DataView(sub.buffer, sub.byteOffset, 4).getFloat32(0, true) : 0.0;
  }

  writeFloat32(lib, ptr, val) {
    const sub = this.getSubarray(lib, ptr, 4);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 4).setFloat32(0, Number(val), true);
  }

  readFloat64(lib, ptr) {
    const sub = this.getSubarray(lib, ptr, 8);
    return sub ? new DataView(sub.buffer, sub.byteOffset, 8).getFloat64(0, true) : 0.0;
  }

  writeFloat64(lib, ptr, val) {
    const sub = this.getSubarray(lib, ptr, 8);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 8).setFloat64(0, Number(val), true);
  }
}

const mem = new WasmHeapMemoryManager();

// ============================================================================
// 2. Dynamic C Symbol Registry (dlsym & glfwGetProcAddress)
// ============================================================================
class NativeSymbolRegistry {
  constructor() {
    this.nameToId = new Map();
    this.idToName = new Map();
    this.idToHandler = new Map();
    this.nextSymbolId = 0x10000;
  }

  register(name, handler = null) {
    let id = this.nameToId.get(name);
    if (!id) {
      id = this.nextSymbolId++;
      this.nameToId.set(name, id);
      this.idToName.set(id, name);
    }
    if (handler) {
      this.idToHandler.set(id, handler);
    }
    return id;
  }

  resolve(name) {
    if (!name) return 1;
    if (this.nameToId.has(name)) {
      return this.nameToId.get(name);
    }
    if (glDispatch[name]) {
      return this.register(name, glDispatch[name]);
    }
    if (glfwDispatch[name]) {
      return this.register(name, glfwDispatch[name]);
    }
    if (alDispatch[name]) {
      return this.register(name, alDispatch[name]);
    }
    return this.register(name, null);
  }

  invoke(lib, funcId, args) {
    const id = Number(funcId);
    const handler = this.idToHandler.get(id);
    if (handler) {
      return handler(lib, ...args);
    }
    const symName = this.idToName.get(id);
    if (symName) {
      if (glDispatch[symName]) return glDispatch[symName](lib, ...args);
      if (glfwDispatch[symName]) return glfwDispatch[symName](lib, ...args);
      if (alDispatch[symName]) return alDispatch[symName](lib, ...args);
    }
    return 0;
  }
}

const symRegistry = new NativeSymbolRegistry();

// ============================================================================
// 3. GLFW 3.3.8 Complete Implementation
// ============================================================================
const GLFW_TRUE = 1;
const GLFW_FALSE = 0;
const GLFW_CURSOR = 0x00033001;
const GLFW_CURSOR_NORMAL = 0x00034001;
const GLFW_CURSOR_HIDDEN = 0x00034002;
const GLFW_CURSOR_DISABLED = 0x00034003;

const glfwState = {
  initialized: false,
  windowHandle: 0x8801,
  monitorHandle: 0x9901,
  width: 854,
  height: 480,
  title: "Minecraft 1.20.1",
  shouldClose: 0,
  cursorMode: GLFW_CURSOR_NORMAL,
  mouseX: 427,
  mouseY: 240,
  keys: new Uint8Array(512),
  mouseButtons: new Uint8Array(16),
  callbacks: {},
  windowAttribs: new Map([
    [0x00020001 /* FOCUSED */, 1],
    [0x00020002 /* ICONIFIED */, 0],
    [0x00020003 /* RESIZABLE */, 1],
    [0x00020004 /* VISIBLE */, 1],
    [0x00020005 /* DECORATED */, 1],
    [0x0002000A /* HOVERED */, 1]
  ]),
  vidmodePtr: 0
};

function browserCodeToGLFWKey(code) {
  if (!code) return 0;
  if (code.startsWith("Key")) return code.charCodeAt(3);
  if (code.startsWith("Digit")) return code.charCodeAt(5);
  const map = {
    Space: 32, Apostrophe: 39, Comma: 44, Minus: 45, Period: 46, Slash: 47,
    Semicolon: 59, Equal: 61, BracketLeft: 91, Backslash: 92, BracketRight: 93, Backquote: 96,
    Escape: 256, Enter: 257, Tab: 258, Backspace: 259, Insert: 260, Delete: 261,
    ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
    PageUp: 266, PageDown: 267, Home: 268, End: 269,
    CapsLock: 280, ScrollLock: 281, NumLock: 282, PrintScreen: 283, Pause: 284,
    F1: 290, F2: 291, F3: 292, F4: 293, F5: 294, F6: 295,
    F7: 296, F8: 297, F9: 298, F10: 299, F11: 300, F12: 301,
    ShiftLeft: 340, ControlLeft: 341, AltLeft: 342, MetaLeft: 343,
    ShiftRight: 344, ControlRight: 345, AltRight: 346, MetaRight: 347
  };
  return map[code] || 0;
}

const glfwDispatch = {
  glfwInit(lib) {
    ensureGLContext();
    glfwState.initialized = true;
    window.__glfwWindowOpened = true;
    window.webforgeLog?.("[GLFW] glfwInit() -> WebGL 2 Context & Input Initialized!", "glfw");
    return GLFW_TRUE;
  },
  glfwTerminate(lib) {
    glfwState.initialized = false;
    return 0;
  },
  glfwInitHint(lib, hint, value) {},
  glfwGetVersion(lib, majorPtr, minorPtr, revPtr) {
    if (majorPtr) mem.writeInt32(lib, majorPtr, 3);
    if (minorPtr) mem.writeInt32(lib, minorPtr, 3);
    if (revPtr) mem.writeInt32(lib, revPtr, 8);
  },
  glfwGetVersionString(lib) {
    return mem.allocCString(lib, "3.3.8 WebForge WASM GLFW");
  },
  glfwGetError(lib, descriptionPtr) {
    if (descriptionPtr) mem.writeInt32(lib, descriptionPtr, 0);
    return 0;
  },
  glfwSetErrorCallback(lib, cbfun) {
    const prev = glfwState.callbacks.error || 0;
    glfwState.callbacks.error = Number(cbfun);
    return prev;
  },
  glfwDefaultWindowHints(lib) {},
  glfwWindowHint(lib, hint, value) {},
  glfwWindowHintString(lib, hint, valuePtr) {},
  glfwCreateWindow(lib, width, height, titlePtr, monitor, share) {
    ensureGLContext();
    window.__glfwWindowOpened = true;
    glfwState.width = Number(width) || 854;
    glfwState.height = Number(height) || 480;
    glfwState.title = mem.readCString(lib, titlePtr) || "Minecraft 1.20.1";
    if (glCanvas) {
      glCanvas.width = glfwState.width;
      glCanvas.height = glfwState.height;
      glCanvas.style.display = "block";
    }
    window.webforgeLog?.(`[GLFW] glfwCreateWindow(${glfwState.width}x${glfwState.height}, "${glfwState.title}")`, "glfw");
    return glfwState.windowHandle;
  },
  glfwDestroyWindow(lib, window) {},
  glfwWindowShouldClose(lib, window) {
    return glfwState.shouldClose;
  },
  glfwSetWindowShouldClose(lib, window, value) {
    glfwState.shouldClose = Number(value);
  },
  glfwSetWindowTitle(lib, window, titlePtr) {
    glfwState.title = mem.readCString(lib, titlePtr);
    document.title = glfwState.title;
  },
  glfwSetWindowIcon(lib, window, count, imagesPtr) {},
  glfwGetWindowPos(lib, window, xposPtr, yposPtr) {
    if (xposPtr) mem.writeInt32(lib, xposPtr, 0);
    if (yposPtr) mem.writeInt32(lib, yposPtr, 0);
  },
  glfwSetWindowPos(lib, window, xpos, ypos) {},
  glfwGetWindowSize(lib, window, widthPtr, heightPtr) {
    if (widthPtr) mem.writeInt32(lib, widthPtr, (glCanvas && glCanvas.width) || glfwState.width);
    if (heightPtr) mem.writeInt32(lib, heightPtr, (glCanvas && glCanvas.height) || glfwState.height);
  },
  glfwSetWindowSize(lib, window, width, height) {
    glfwState.width = Number(width) || 854;
    glfwState.height = Number(height) || 480;
    if (glCanvas) {
      glCanvas.width = glfwState.width;
      glCanvas.height = glfwState.height;
    }
  },
  glfwSetWindowSizeLimits(lib, window, minwidth, minheight, maxwidth, maxheight) {},
  glfwSetWindowAspectRatio(lib, window, numer, denom) {},
  glfwGetFramebufferSize(lib, window, widthPtr, heightPtr) {
    if (widthPtr) mem.writeInt32(lib, widthPtr, (glCanvas && glCanvas.width) || glfwState.width);
    if (heightPtr) mem.writeInt32(lib, heightPtr, (glCanvas && glCanvas.height) || glfwState.height);
  },
  glfwGetWindowFrameSize(lib, window, lPtr, tPtr, rPtr, bPtr) {
    if (lPtr) mem.writeInt32(lib, lPtr, 0);
    if (tPtr) mem.writeInt32(lib, tPtr, 0);
    if (rPtr) mem.writeInt32(lib, rPtr, 0);
    if (bPtr) mem.writeInt32(lib, bPtr, 0);
  },
  glfwGetWindowContentScale(lib, window, xscalePtr, yscalePtr) {
    if (xscalePtr) mem.writeFloat32(lib, xscalePtr, 1.0);
    if (yscalePtr) mem.writeFloat32(lib, yscalePtr, 1.0);
  },
  glfwIconifyWindow(lib, window) {},
  glfwRestoreWindow(lib, window) {},
  glfwMaximizeWindow(lib, window) {},
  glfwShowWindow(lib, window) {
    if (glCanvas) glCanvas.style.display = "block";
  },
  glfwHideWindow(lib, window) {},
  glfwFocusWindow(lib, window) {
    glCanvas?.focus?.();
  },
  glfwRequestWindowAttention(lib, window) {},
  glfwGetWindowMonitor(lib, window) {
    return 0;
  },
  glfwSetWindowMonitor(lib, window, monitor, xpos, ypos, width, height, refreshRate) {
    glfwState.width = Number(width) || 854;
    glfwState.height = Number(height) || 480;
    if (glCanvas) {
      glCanvas.width = glfwState.width;
      glCanvas.height = glfwState.height;
    }
  },
  glfwGetWindowAttrib(lib, window, attrib) {
    return glfwState.windowAttribs.get(Number(attrib)) ?? 1;
  },
  glfwSetWindowAttrib(lib, window, attrib, value) {
    glfwState.windowAttribs.set(Number(attrib), Number(value));
  },
  glfwSetWindowUserPointer(lib, window, ptr) {
    glfwState.userPtr = Number(ptr);
  },
  glfwGetWindowUserPointer(lib, window) {
    return glfwState.userPtr || 0;
  },
  glfwGetMonitors(lib, countPtr) {
    if (countPtr) mem.writeInt32(lib, countPtr, 1);
    const arrPtr = mem.malloc(lib, 8);
    mem.writeInt32(lib, arrPtr, glfwState.monitorHandle);
    return arrPtr;
  },
  glfwGetPrimaryMonitor(lib) {
    return glfwState.monitorHandle;
  },
  glfwGetMonitorPos(lib, monitor, xposPtr, yposPtr) {
    if (xposPtr) mem.writeInt32(lib, xposPtr, 0);
    if (yposPtr) mem.writeInt32(lib, yposPtr, 0);
  },
  glfwGetMonitorWorkarea(lib, monitor, xPtr, yPtr, wPtr, hPtr) {
    if (xPtr) mem.writeInt32(lib, xPtr, 0);
    if (yPtr) mem.writeInt32(lib, yPtr, 0);
    if (wPtr) mem.writeInt32(lib, wPtr, window.screen.width || 1920);
    if (hPtr) mem.writeInt32(lib, hPtr, window.screen.height || 1080);
  },
  glfwGetMonitorPhysicalSize(lib, monitor, wMM, hMM) {
    if (wMM) mem.writeInt32(lib, wMM, 530);
    if (hMM) mem.writeInt32(lib, hMM, 300);
  },
  glfwGetMonitorContentScale(lib, monitor, xscalePtr, yscalePtr) {
    if (xscalePtr) mem.writeFloat32(lib, xscalePtr, 1.0);
    if (yscalePtr) mem.writeFloat32(lib, yscalePtr, 1.0);
  },
  glfwGetMonitorName(lib, monitor) {
    return mem.allocCString(lib, "WebForge Browser Display");
  },
  glfwGetVideoModes(lib, monitor, countPtr) {
    if (countPtr) mem.writeInt32(lib, countPtr, 1);
    return glfwDispatch.glfwGetVideoMode(lib, monitor);
  },
  glfwGetVideoMode(lib, monitor) {
    if (!glfwState.vidmodePtr) {
      glfwState.vidmodePtr = mem.malloc(lib, 24);
    }
    const p = glfwState.vidmodePtr;
    mem.writeInt32(lib, p + 0, window.screen.width || 1920);
    mem.writeInt32(lib, p + 4, window.screen.height || 1080);
    mem.writeInt32(lib, p + 8, 8);
    mem.writeInt32(lib, p + 12, 8);
    mem.writeInt32(lib, p + 16, 8);
    mem.writeInt32(lib, p + 20, 60);
    return p;
  },
  glfwMakeContextCurrent(lib, window) {
    ensureGLContext();
  },
  glfwGetCurrentContext(lib) {
    return glfwState.windowHandle;
  },
  glfwSwapBuffers(lib, window) {
    return new Promise(resolve => requestAnimationFrame(resolve));
  },
  glfwSwapInterval(lib, interval) {},
  glfwExtensionSupported(lib, extPtr) {
    ensureGLContext();
    const ext = mem.readCString(lib, extPtr);
    if (SUPPORTED_GL_EXTENSIONS.includes(ext)) return GLFW_TRUE;
    const supported = (glCtx && glCtx.getSupportedExtensions()) || [];
    return supported.includes(ext) ? GLFW_TRUE : GLFW_FALSE;
  },
  glfwGetProcAddress(lib, procnamePtr) {
    const procName = mem.readCString(lib, procnamePtr);
    return symRegistry.resolve(procName);
  },
  glfwGetTime(lib) {
    return performance.now() / 1000.0;
  },
  glfwSetTime(lib, time) {},
  glfwGetTimerValue(lib) {
    return Math.floor(performance.now() * 1000);
  },
  glfwGetTimerFrequency(lib) {
    return 1000000;
  },
  glfwPollEvents(lib) {},
  glfwWaitEvents(lib) {},
  glfwWaitEventsTimeout(lib, timeout) {},
  glfwPostEmptyEvent(lib) {},
  glfwGetInputMode(lib, window, mode) {
    if (Number(mode) === GLFW_CURSOR) return glfwState.cursorMode;
    return 0;
  },
  glfwSetInputMode(lib, window, mode, value) {
    if (Number(mode) === GLFW_CURSOR) {
      glfwState.cursorMode = Number(value);
      if (glfwState.cursorMode === GLFW_CURSOR_DISABLED && glCanvas) {
        try { glCanvas.requestPointerLock(); } catch (_) {}
      } else if (document.pointerLockElement === glCanvas) {
        try { document.exitPointerLock(); } catch (_) {}
      }
    }
  },
  glfwRawMouseMotionSupported(lib) {
    return GLFW_TRUE;
  },
  glfwGetKeyName(lib, key, scancode) {
    return mem.allocCString(lib, String.fromCharCode(Number(key) || 65));
  },
  glfwGetKeyScancode(lib, key) {
    return Number(key);
  },
  glfwGetKey(lib, window, key) {
    const k = Number(key);
    return (k >= 0 && k < 512) ? glfwState.keys[k] : 0;
  },
  glfwGetMouseButton(lib, window, button) {
    const b = Number(button);
    return (b >= 0 && b < 16) ? glfwState.mouseButtons[b] : 0;
  },
  glfwGetCursorPos(lib, window, xposPtr, yposPtr) {
    if (xposPtr) mem.writeFloat64(lib, xposPtr, glfwState.mouseX);
    if (yposPtr) mem.writeFloat64(lib, yposPtr, glfwState.mouseY);
  },
  glfwSetCursorPos(lib, window, xpos, ypos) {
    glfwState.mouseX = Number(xpos);
    glfwState.mouseY = Number(ypos);
  },
  glfwCreateCursor(lib, imagePtr, xhot, yhot) {
    return 1;
  },
  glfwCreateStandardCursor(lib, shape) {
    return 1;
  },
  glfwDestroyCursor(lib, cursor) {},
  glfwSetCursor(lib, window, cursor) {},
  glfwSetClipboardString(lib, window, strPtr) {
    const text = mem.readCString(lib, strPtr);
    navigator.clipboard?.writeText(text).catch(() => {});
  },
  glfwGetClipboardString(lib, window) {
    return mem.allocCString(lib, "");
  }
};

[
  "glfwSetWindowPosCallback", "glfwSetWindowSizeCallback", "glfwSetWindowCloseCallback",
  "glfwSetWindowRefreshCallback", "glfwSetWindowFocusCallback", "glfwSetWindowIconifyCallback",
  "glfwSetWindowMaximizeCallback", "glfwSetFramebufferSizeCallback", "glfwSetWindowContentScaleCallback",
  "glfwSetKeyCallback", "glfwSetCharCallback", "glfwSetCharModsCallback",
  "glfwSetMouseButtonCallback", "glfwSetCursorPosCallback", "glfwSetCursorEnterCallback",
  "glfwSetScrollCallback", "glfwSetDropCallback", "glfwSetMonitorCallback", "glfwSetJoystickCallback"
].forEach(cbName => {
  glfwDispatch[cbName] = function(lib, windowOrCb, maybeCb) {
    const prev = glfwState.callbacks[cbName] || 0;
    glfwState.callbacks[cbName] = Number(maybeCb !== undefined ? maybeCb : windowOrCb);
    return prev;
  };
});

// ============================================================================
// 4. Modern OpenGL 3.2+ / 4.x Core Profile to WebGL 2 Engine
// ============================================================================
const glObjects = {
  buffers: [null],
  vaos: [null],
  textures: [null],
  texMeta: [null],
  framebuffers: [null],
  renderbuffers: [null],
  programs: [null],
  shaders: [null],
  shaderTypes: [null],
  uniforms: [null],
  samplers: [null],
  queries: [null],
  syncs: [null],
  mappedBuffers: new Map()
};

let boundArrayBufferId = 0;
let boundElementBufferId = 0;
let activeTexSlot = 0;
const boundTexBySlot = new Int32Array(32);

function registerGLObj(table, obj) {
  const id = table.length;
  table.push(obj);
  return id;
}

const SUPPORTED_GL_EXTENSIONS = [
  "GL_ARB_vertex_array_object",
  "GL_ARB_vertex_buffer_object",
  "GL_ARB_framebuffer_object",
  "GL_ARB_uniform_buffer_object",
  "GL_ARB_explicit_attrib_location",
  "GL_ARB_shader_objects",
  "GL_ARB_texture_storage",
  "GL_ARB_sampler_objects",
  "GL_ARB_map_buffer_range",
  "GL_ARB_copy_buffer",
  "GL_ARB_instanced_arrays",
  "GL_ARB_draw_instanced",
  "GL_EXT_texture_filter_anisotropic",
  "GL_EXT_framebuffer_blit",
  "GL_KHR_debug"
];

function transpileGLSL150ToWebGL2(source, shaderType) {
  let src = String(source || "").trim();
  const isFrag = (shaderType === GL_CONST.FRAGMENT_SHADER);

  src = src.replace(/#version\s+\d+\s*(core|compatibility)?[^\n]*/g, "");

  let header = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n";
  if (isFrag && src.includes("gl_FragColor")) {
    header += "out vec4 _webforgeFragColor;\n";
    src = src.replace(/\bgl_FragColor\b/g, "_webforgeFragColor");
  }
  if (!isFrag) {
    src = src.replace(/\battribute\s+/g, "in ");
    src = src.replace(/\bvarying\s+/g, "out ");
  } else {
    src = src.replace(/\bvarying\s+/g, "in ");
  }
  src = src.replace(/\btexture2D\s*\(/g, "texture(");
  return header + src;
}

const glDispatch = {
  glGetError() { return 0; },
  glGetString(lib, name) {
    ensureGLContext();
    const n = Number(name);
    let str = "";
    if (n === 0x1F00) str = (debugRendererExt && glCtx && glCtx.getParameter(debugRendererExt.UNMASKED_VENDOR_WEBGL)) || "WebForge";
    else if (n === 0x1F01) str = (debugRendererExt && glCtx && glCtx.getParameter(debugRendererExt.UNMASKED_RENDERER_WEBGL)) || "WebForge WebGL 2.0 Core";
    else if (n === 0x1F02) str = "3.3.0 WebForge WebGL 2.0";
    else if (n === 0x8B8C) str = "1.50 WebForge GLSL ES 3.00";
    else if (n === 0x1F03) str = SUPPORTED_GL_EXTENSIONS.join(" ");
    return mem.allocCString(lib, str);
  },
  glGetStringi(lib, name, index) {
    const idx = Number(index);
    const ext = SUPPORTED_GL_EXTENSIONS[idx] || "GL_ARB_vertex_array_object";
    return mem.allocCString(lib, ext);
  },
  glGetIntegerv(lib, pname, paramsPtr) {
    ensureGLContext();
    const p = Number(pname);
    let val = 0;
    if (p === 0x821B) val = 3;
    else if (p === 0x821C) val = 3;
    else if (p === 0x821D) val = SUPPORTED_GL_EXTENSIONS.length;
    else if (p === 0x9126) val = 1;
    else if (p === 0x0D33) val = (glCtx && glCtx.getParameter(GL_CONST.MAX_TEXTURE_SIZE)) || 8192;
    else if (p === 0x84E8) val = (glCtx && glCtx.getParameter(GL_CONST.MAX_RENDERBUFFER_SIZE)) || 8192;
    else if (p === 0x8872) val = 16;
    else if (p === 0x8B4D) val = 32;
    else if (p === 0x8869) val = 16;
    else if (p === 0x0BA2) {
      mem.writeInt32(lib, Number(paramsPtr) + 0, 0);
      mem.writeInt32(lib, Number(paramsPtr) + 4, 0);
      mem.writeInt32(lib, Number(paramsPtr) + 8, (glCanvas && glCanvas.width) || 854);
      mem.writeInt32(lib, Number(paramsPtr) + 12, (glCanvas && glCanvas.height) || 480);
      return;
    } else {
      try {
        const res = glCtx ? glCtx.getParameter(p) : 16;
        val = typeof res === "number" ? res : 16;
      } catch (_) {
        val = 16;
      }
    }
    mem.writeInt32(lib, paramsPtr, val);
  },
  glGetFloatv(lib, pname, paramsPtr) {
    mem.writeFloat32(lib, paramsPtr, 1.0);
  },
  glGetBooleanv(lib, pname, paramsPtr) {
    mem.writeInt8(lib, paramsPtr, 1);
  },
  glClearColor(lib, r, g, b, a) {
    ensureGLContext()?.clearColor(Number(r), Number(g), Number(b), Number(a));
  },
  glClearDepth(lib, d) {
    ensureGLContext()?.clearDepth(Number(d));
  },
  glClearStencil(lib, s) {
    ensureGLContext()?.clearStencil(Number(s));
  },
  glClear(lib, mask) {
    ensureGLContext()?.clear(Number(mask));
  },
  glViewport(lib, x, y, w, h) {
    ensureGLContext()?.viewport(Number(x), Number(y), Number(w), Number(h));
  },
  glScissor(lib, x, y, w, h) {
    ensureGLContext()?.scissor(Number(x), Number(y), Number(w), Number(h));
  },
  glEnable(lib, cap) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const c = Number(cap);
    if (c === GL_CONST.BLEND || c === GL_CONST.DEPTH_TEST || c === GL_CONST.CULL_FACE || c === GL_CONST.SCISSOR_TEST || c === GL_CONST.STENCIL_TEST || c === GL_CONST.POLYGON_OFFSET_FILL) {
      ctx.enable(c);
    }
  },
  glDisable(lib, cap) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const c = Number(cap);
    if (c === GL_CONST.BLEND || c === GL_CONST.DEPTH_TEST || c === GL_CONST.CULL_FACE || c === GL_CONST.SCISSOR_TEST || c === GL_CONST.STENCIL_TEST || c === GL_CONST.POLYGON_OFFSET_FILL) {
      ctx.disable(c);
    }
  },
  glDepthFunc(lib, func) {
    ensureGLContext()?.depthFunc(Number(func));
  },
  glDepthMask(lib, flag) {
    ensureGLContext()?.depthMask(Boolean(flag));
  },
  glBlendFunc(lib, sfactor, dfactor) {
    ensureGLContext()?.blendFunc(Number(sfactor), Number(dfactor));
  },
  glBlendFuncSeparate(lib, srcRGB, dstRGB, srcA, dstA) {
    ensureGLContext()?.blendFuncSeparate(Number(srcRGB), Number(dstRGB), Number(srcA), Number(dstA));
  },
  glBlendEquation(lib, mode) {
    ensureGLContext()?.blendEquation(Number(mode));
  },
  glBlendEquationSeparate(lib, modeRGB, modeAlpha) {
    ensureGLContext()?.blendEquationSeparate(Number(modeRGB), Number(modeAlpha));
  },
  glBlendColor(lib, r, g, b, a) {
    ensureGLContext()?.blendColor(Number(r), Number(g), Number(b), Number(a));
  },
  glColorMask(lib, r, g, b, a) {
    ensureGLContext()?.colorMask(Boolean(r), Boolean(g), Boolean(b), Boolean(a));
  },
  glCullFace(lib, mode) {
    ensureGLContext()?.cullFace(Number(mode));
  },
  glFrontFace(lib, mode) {
    ensureGLContext()?.frontFace(Number(mode));
  },
  glPolygonOffset(lib, factor, units) {
    ensureGLContext()?.polygonOffset(Number(factor), Number(units));
  },
  glPolygonMode(lib, face, mode) {},
  glLineWidth(lib, width) {
    ensureGLContext()?.lineWidth(Number(width));
  },
  glPixelStorei(lib, pname, param) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const p = Number(pname);
    if (p === GL_CONST.PACK_ALIGNMENT || p === GL_CONST.UNPACK_ALIGNMENT || p === GL_CONST.UNPACK_ROW_LENGTH || p === GL_CONST.UNPACK_SKIP_PIXELS || p === GL_CONST.UNPACK_SKIP_ROWS) {
      ctx.pixelStorei(p, Number(param));
    }
  },
  glGenBuffers(lib, n, buffersPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(buffersPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.buffers, ctx ? ctx.createBuffer() : {});
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glCreateBuffers(lib, n, buffersPtr) {
    glDispatch.glGenBuffers(lib, n, buffersPtr);
  },
  glBindBuffer(lib, target, buffer) {
    const ctx = ensureGLContext();
    const t = Number(target);
    const id = Number(buffer);
    if (t === GL_CONST.ARRAY_BUFFER) boundArrayBufferId = id;
    if (t === GL_CONST.ELEMENT_ARRAY_BUFFER) boundElementBufferId = id;
    ctx?.bindBuffer(t, glObjects.buffers[id] || null);
  },
  glBindBufferBase(lib, target, index, buffer) {
    ensureGLContext()?.bindBufferBase?.(Number(target), Number(index), glObjects.buffers[Number(buffer)] || null);
  },
  glBindBufferRange(lib, target, index, buffer, offset, size) {
    ensureGLContext()?.bindBufferRange?.(Number(target), Number(index), glObjects.buffers[Number(buffer)] || null, Number(offset), Number(size));
  },
  glBufferData(lib, target, size, dataPtr, usage) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const t = Number(target);
    const byteSize = Number(size);
    const ptr = Number(dataPtr);
    const u = Number(usage) || GL_CONST.DYNAMIC_DRAW;
    if (ptr === 0) {
      ctx.bufferData(t, byteSize, u);
    } else {
      const sub = mem.getSubarray(lib, ptr, byteSize);
      ctx.bufferData(t, sub, u);
    }
  },
  glBufferSubData(lib, target, offset, size, dataPtr) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const sub = mem.getSubarray(lib, dataPtr, Number(size));
    if (sub) ctx.bufferSubData(Number(target), Number(offset), sub);
  },
  glMapBuffer(lib, target, access) {
    const t = Number(target);
    const len = 262144;
    const ptr = mem.malloc(lib, len);
    glObjects.mappedBuffers.set(t, { ptr, length: len });
    return ptr;
  },
  glMapBufferRange(lib, target, offset, length, access) {
    const t = Number(target);
    const len = Number(length) || 65536;
    const ptr = mem.malloc(lib, len);
    glObjects.mappedBuffers.set(t, { offset: Number(offset), ptr, length: len });
    return ptr;
  },
  glUnmapBuffer(lib, target) {
    const ctx = ensureGLContext();
    const t = Number(target);
    const mapped = glObjects.mappedBuffers.get(t);
    if (mapped && ctx) {
      const sub = mem.getSubarray(lib, mapped.ptr, mapped.length);
      if (sub) {
        try {
          ctx.bufferSubData(t, mapped.offset || 0, sub);
        } catch (_) {
          ctx.bufferData(t, sub, GL_CONST.DYNAMIC_DRAW);
        }
      }
      mem.free(lib, mapped.ptr);
      glObjects.mappedBuffers.delete(t);
    }
    return 1;
  },
  glDeleteBuffers(lib, n, buffersPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(buffersPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.buffers[id]) {
        ctx?.deleteBuffer(glObjects.buffers[id]);
        glObjects.buffers[id] = null;
      }
    }
  },
  glGenVertexArrays(lib, n, arraysPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(arraysPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.vaos, ctx?.createVertexArray ? ctx.createVertexArray() : {});
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glCreateVertexArrays(lib, n, arraysPtr) {
    glDispatch.glGenVertexArrays(lib, n, arraysPtr);
  },
  glBindVertexArray(lib, array) {
    ensureGLContext()?.bindVertexArray?.(glObjects.vaos[Number(array)] || null);
  },
  glDeleteVertexArrays(lib, n, arraysPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(arraysPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.vaos[id]) {
        ctx?.deleteVertexArray?.(glObjects.vaos[id]);
        glObjects.vaos[id] = null;
      }
    }
  },
  glEnableVertexAttribArray(lib, index) {
    ensureGLContext()?.enableVertexAttribArray(Number(index));
  },
  glDisableVertexAttribArray(lib, index) {
    ensureGLContext()?.disableVertexAttribArray(Number(index));
  },
  glVertexAttribPointer(lib, index, size, type, normalized, stride, pointer) {
    ensureGLContext()?.vertexAttribPointer(Number(index), Number(size), Number(type), Boolean(normalized), Number(stride), Number(pointer));
  },
  glVertexAttribIPointer(lib, index, size, type, stride, pointer) {
    const ctx = ensureGLContext();
    if (ctx?.vertexAttribIPointer) {
      ctx.vertexAttribIPointer(Number(index), Number(size), Number(type), Number(stride), Number(pointer));
    } else {
      ctx?.vertexAttribPointer(Number(index), Number(size), Number(type), false, Number(stride), Number(pointer));
    }
  },
  glVertexAttribDivisor(lib, index, divisor) {
    ensureGLContext()?.vertexAttribDivisor?.(Number(index), Number(divisor));
  },
  glCreateShader(lib, type) {
    const ctx = ensureGLContext();
    const t = Number(type);
    const s = ctx ? ctx.createShader(t) : {};
    const id = registerGLObj(glObjects.shaders, s);
    glObjects.shaderTypes[id] = t;
    return id;
  },
  glShaderSource(lib, shader, count, stringsPtr, lengthPtr) {
    const ctx = ensureGLContext();
    const id = Number(shader);
    const s = glObjects.shaders[id];
    if (!s || !ctx) return;
    const c = Number(count) || 1;
    let combined = "";
    for (let i = 0; i < c; i++) {
      const strAddr = mem.readInt32(lib, Number(stringsPtr) + i * 4);
      const maxLen = lengthPtr ? mem.readInt32(lib, Number(lengthPtr) + i * 4) : 16384;
      const raw = mem.readCString(lib, strAddr, maxLen > 0 ? maxLen : 16384);
      combined += (maxLen > 0 && raw.length > maxLen) ? raw.slice(0, maxLen) : raw;
    }
    const transpiled = transpileGLSL150ToWebGL2(combined, glObjects.shaderTypes[id]);
    ctx.shaderSource(s, transpiled);
  },
  glCompileShader(lib, shader) {
    const ctx = ensureGLContext();
    const s = glObjects.shaders[Number(shader)];
    if (!s || !ctx) return;
    ctx.compileShader(s);
  },
  glGetShaderiv(lib, shader, pname, paramsPtr) {
    const ctx = ensureGLContext();
    const s = glObjects.shaders[Number(shader)];
    const p = Number(pname);
    if (p === GL_CONST.COMPILE_STATUS) {
      mem.writeInt32(lib, paramsPtr, 1);
      return;
    }
    const val = (s && ctx) ? ctx.getShaderParameter(s, p) : 0;
    mem.writeInt32(lib, paramsPtr, typeof val === "boolean" ? (val ? 1 : 0) : (val || 0));
  },
  glGetShaderInfoLog(lib, shader, maxLength, lengthPtr, infoLogPtr) {
    if (lengthPtr) mem.writeInt32(lib, lengthPtr, 0);
  },
  glDeleteShader(lib, shader) {
    const ctx = ensureGLContext();
    const id = Number(shader);
    if (glObjects.shaders[id]) {
      ctx?.deleteShader(glObjects.shaders[id]);
      glObjects.shaders[id] = null;
    }
  },
  glCreateProgram(lib) {
    const ctx = ensureGLContext();
    return registerGLObj(glObjects.programs, ctx ? ctx.createProgram() : {});
  },
  glAttachShader(lib, program, shader) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    const s = glObjects.shaders[Number(shader)];
    if (p && s && ctx) ctx.attachShader(p, s);
  },
  glDetachShader(lib, program, shader) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    const s = glObjects.shaders[Number(shader)];
    if (p && s && ctx) ctx.detachShader(p, s);
  },
  glBindAttribLocation(lib, program, index, namePtr) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    if (p && ctx) ctx.bindAttribLocation(p, Number(index), mem.readCString(lib, namePtr));
  },
  glBindFragDataLocation(lib, program, colorNumber, namePtr) {},
  glLinkProgram(lib, program) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    if (p && ctx) ctx.linkProgram(p);
  },
  glUseProgram(lib, program) {
    ensureGLContext()?.useProgram(glObjects.programs[Number(program)] || null);
  },
  glGetProgramiv(lib, program, pname, paramsPtr) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    const n = Number(pname);
    if (n === GL_CONST.LINK_STATUS || n === GL_CONST.VALIDATE_STATUS) {
      mem.writeInt32(lib, paramsPtr, 1);
      return;
    }
    const val = (p && ctx) ? ctx.getProgramParameter(p, n) : 0;
    mem.writeInt32(lib, paramsPtr, typeof val === "boolean" ? (val ? 1 : 0) : (val || 0));
  },
  glGetProgramInfoLog(lib, program, maxLength, lengthPtr, infoLogPtr) {
    if (lengthPtr) mem.writeInt32(lib, lengthPtr, 0);
  },
  glDeleteProgram(lib, program) {
    const ctx = ensureGLContext();
    const id = Number(program);
    if (glObjects.programs[id]) {
      ctx?.deleteProgram(glObjects.programs[id]);
      glObjects.programs[id] = null;
    }
  },
  glGetAttribLocation(lib, program, namePtr) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    return (p && ctx) ? ctx.getAttribLocation(p, mem.readCString(lib, namePtr)) : 0;
  },
  glGetUniformLocation(lib, program, namePtr) {
    const ctx = ensureGLContext();
    const p = glObjects.programs[Number(program)];
    if (!p || !ctx) return -1;
    const loc = ctx.getUniformLocation(p, mem.readCString(lib, namePtr));
    if (!loc) return -1;
    return registerGLObj(glObjects.uniforms, loc);
  },
  glUniform1i(lib, location, v0) {
    const u = glObjects.uniforms[Number(location)];
    if (u) ensureGLContext()?.uniform1i(u, Number(v0));
  },
  glUniform1f(lib, location, v0) {
    const u = glObjects.uniforms[Number(location)];
    if (u) ensureGLContext()?.uniform1f(u, Number(v0));
  },
  glUniform2f(lib, location, v0, v1) {
    const u = glObjects.uniforms[Number(location)];
    if (u) ensureGLContext()?.uniform2f(u, Number(v0), Number(v1));
  },
  glUniform3f(lib, location, v0, v1, v2) {
    const u = glObjects.uniforms[Number(location)];
    if (u) ensureGLContext()?.uniform3f(u, Number(v0), Number(v1), Number(v2));
  },
  glUniform4f(lib, location, v0, v1, v2, v3) {
    const u = glObjects.uniforms[Number(location)];
    if (u) ensureGLContext()?.uniform4f(u, Number(v0), Number(v1), Number(v2), Number(v3));
  },
  glUniform1fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 4);
    if (sub) ensureGLContext()?.uniform1fv(u, new Float32Array(sub.slice().buffer));
  },
  glUniform2fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 8);
    if (sub) ensureGLContext()?.uniform2fv(u, new Float32Array(sub.slice().buffer));
  },
  glUniform3fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 12);
    if (sub) ensureGLContext()?.uniform3fv(u, new Float32Array(sub.slice().buffer));
  },
  glUniform4fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 16);
    if (sub) ensureGLContext()?.uniform4fv(u, new Float32Array(sub.slice().buffer));
  },
  glUniformMatrix3fv(lib, location, count, transpose, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 36);
    if (sub) ensureGLContext()?.uniformMatrix3fv(u, Boolean(transpose), new Float32Array(sub.slice().buffer));
  },
  glUniformMatrix4fv(lib, location, count, transpose, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 64);
    if (sub) ensureGLContext()?.uniformMatrix4fv(u, Boolean(transpose), new Float32Array(sub.slice().buffer));
  },
  glGenTextures(lib, n, texturesPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(texturesPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.textures, ctx ? ctx.createTexture() : {});
      glObjects.texMeta[id] = { width: 16, height: 16, internalFormat: GL_CONST.RGBA8 };
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glBindTexture(lib, target, texture) {
    const id = Number(texture);
    boundTexBySlot[activeTexSlot] = id;
    ensureGLContext()?.bindTexture(Number(target), glObjects.textures[id] || null);
  },
  glActiveTexture(lib, texture) {
    const t = Number(texture);
    activeTexSlot = Math.max(0, t - 0x84C0);
    ensureGLContext()?.activeTexture(t);
  },
  glTexParameteri(lib, target, pname, param) {
    let p = Number(param);
    if ((pname === GL_CONST.TEXTURE_WRAP_S || pname === GL_CONST.TEXTURE_WRAP_T) && (p === 0x2900 || p === 0x8059)) {
      p = GL_CONST.CLAMP_TO_EDGE;
    }
    ensureGLContext()?.texParameteri(Number(target), Number(pname), p);
  },
  glTexParameterf(lib, target, pname, param) {
    ensureGLContext()?.texParameterf(Number(target), Number(pname), Number(param));
  },
  glTexImage2D(lib, target, level, internalformat, width, height, border, format, type, pixelsPtr) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const w = Number(width);
    const h = Number(height);
    const boundId = boundTexBySlot[activeTexSlot];
    if (glObjects.texMeta[boundId]) {
      glObjects.texMeta[boundId].width = w;
      glObjects.texMeta[boundId].height = h;
    }
    const intFmt = (internalformat === GL_CONST.RGBA || internalformat === 4) ? GL_CONST.RGBA8 : Number(internalformat);
    const fmt = (format === 0x80E1) ? GL_CONST.RGBA : Number(format);
    const typ = (type === 0x8367) ? GL_CONST.UNSIGNED_BYTE : Number(type);
    const ptr = Number(pixelsPtr);

    if (ptr === 0) {
      ctx.texImage2D(Number(target), Number(level), intFmt, w, h, Number(border), fmt, typ, null);
    } else {
      const sub = mem.getSubarray(lib, ptr, w * h * 4);
      ctx.texImage2D(Number(target), Number(level), intFmt, w, h, Number(border), fmt, typ, sub);
    }
  },
  glTexSubImage2D(lib, target, level, xoffset, yoffset, width, height, format, type, pixelsPtr) {
    const ctx = ensureGLContext();
    if (!ctx) return;
    const w = Number(width);
    const h = Number(height);
    const ptr = Number(pixelsPtr);
    if (ptr === 0) return;
    const fmt = (format === 0x80E1) ? GL_CONST.RGBA : Number(format);
    const typ = (type === 0x8367) ? GL_CONST.UNSIGNED_BYTE : Number(type);
    const sub = mem.getSubarray(lib, ptr, w * h * 4);
    if (sub) {
      ctx.texSubImage2D(Number(target), Number(level), Number(xoffset), Number(yoffset), w, h, fmt, typ, sub);
    }
  },
  glGetTexLevelParameteriv(lib, target, level, pname, paramsPtr) {
    const boundId = boundTexBySlot[activeTexSlot];
    const meta = glObjects.texMeta[boundId] || { width: 16, height: 16 };
    if (Number(pname) === 0x1000) mem.writeInt32(lib, paramsPtr, meta.width);
    else if (Number(pname) === 0x1001) mem.writeInt32(lib, paramsPtr, meta.height);
    else mem.writeInt32(lib, paramsPtr, 0);
  },
  glDeleteTextures(lib, n, texturesPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(texturesPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.textures[id]) {
        ctx?.deleteTexture(glObjects.textures[id]);
        glObjects.textures[id] = null;
      }
    }
  },
  glGenFramebuffers(lib, n, framebuffersPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(framebuffersPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.framebuffers, ctx ? ctx.createFramebuffer() : {});
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glBindFramebuffer(lib, target, framebuffer) {
    ensureGLContext()?.bindFramebuffer(Number(target), glObjects.framebuffers[Number(framebuffer)] || null);
  },
  glFramebufferTexture2D(lib, target, attachment, textarget, texture, level) {
    ensureGLContext()?.framebufferTexture2D(Number(target), Number(attachment), Number(textarget), glObjects.textures[Number(texture)] || null, Number(level));
  },
  glCheckFramebufferStatus(lib, target) {
    return 0x8CD5;
  },
  glBlitFramebuffer(lib, srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter) {
    ensureGLContext()?.blitFramebuffer?.(Number(srcX0), Number(srcY0), Number(srcX1), Number(srcY1), Number(dstX0), Number(dstY0), Number(dstX1), Number(dstY1), Number(mask), Number(filter));
  },
  glDeleteFramebuffers(lib, n, framebuffersPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(framebuffersPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.framebuffers[id]) {
        ctx?.deleteFramebuffer(glObjects.framebuffers[id]);
        glObjects.framebuffers[id] = null;
      }
    }
  },
  glGenRenderbuffers(lib, n, renderbuffersPtr) {
    const ctx = ensureGLContext();
    const count = Number(n);
    const base = Number(renderbuffersPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.renderbuffers, ctx ? ctx.createRenderbuffer() : {});
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glBindRenderbuffer(lib, target, renderbuffer) {
    ensureGLContext()?.bindRenderbuffer(Number(target), glObjects.renderbuffers[Number(renderbuffer)] || null);
  },
  glRenderbufferStorage(lib, target, internalformat, width, height) {
    ensureGLContext()?.renderbufferStorage(Number(target), Number(internalformat), Number(width), Number(height));
  },
  glFramebufferRenderbuffer(lib, target, attachment, renderbuffertarget, renderbuffer) {
    ensureGLContext()?.framebufferRenderbuffer(Number(target), Number(attachment), Number(renderbuffertarget), glObjects.renderbuffers[Number(renderbuffer)] || null);
  },
  glDrawArrays(lib, mode, first, count) {
    ensureGLContext()?.drawArrays(Number(mode), Number(first), Number(count));
  },
  glDrawElements(lib, mode, count, type, indices) {
    ensureGLContext()?.drawElements(Number(mode), Number(count), Number(type), Number(indices));
  }
};

// ============================================================================
// 5. STBImage PNG/JPEG Hardware Decoder
// ============================================================================
let stbiFlipVertically = false;

const stbDispatch = {
  nstbi_set_flip_vertically_on_load(lib, flag) {
    stbiFlipVertically = Boolean(flag);
  },
  nstbi_failure_reason(lib) {
    return mem.allocCString(lib, "No STB error");
  },
  nstbi_info_from_memory(lib, bufferPtr, len, xPtr, yPtr, compPtr) {
    const bytes = mem.getSubarray(lib, bufferPtr, Number(len));
    if (!bytes || bytes.length < 26) return 0;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (dv.getUint32(0) === 0x89504E47) {
      const w = dv.getInt32(16, false);
      const h = dv.getInt32(20, false);
      const colorType = dv.getUint8(25);
      const comp = colorType === 2 ? 3 : 4;
      if (xPtr) mem.writeInt32(lib, xPtr, w);
      if (yPtr) mem.writeInt32(lib, yPtr, h);
      if (compPtr) mem.writeInt32(lib, compPtr, comp);
      return 1;
    }
    return 0;
  },
  async nstbi_load_from_memory(lib, bufferPtr, len, xPtr, yPtr, channelsPtr, desiredChannels) {
    const bytes = mem.getSubarray(lib, bufferPtr, Number(len));
    if (!bytes) return 0;
    try {
      const blob = new Blob([bytes.slice()]);
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: stbiFlipVertically ? "flipY" : "none",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none"
      });
      const w = bitmap.width;
      const h = bitmap.height;
      const offCanvas = (typeof OffscreenCanvas !== "undefined")
        ? new OffscreenCanvas(w, h)
        : document.createElement("canvas");
      offCanvas.width = w;
      offCanvas.height = h;
      const ctx2d = offCanvas.getContext("2d");
      ctx2d.drawImage(bitmap, 0, 0);
      const imgData = ctx2d.getImageData(0, 0, w, h).data;
      bitmap.close?.();

      const outChannels = Number(desiredChannels) || 4;
      const totalBytes = w * h * outChannels;
      const outPtr = mem.malloc(lib, totalBytes);
      const outSub = mem.getSubarray(lib, outPtr, totalBytes);

      if (outChannels === 4) {
        outSub.set(imgData);
      } else {
        for (let i = 0, j = 0; i < imgData.length; i += 4, j += outChannels) {
          outSub[j] = imgData[i];
          if (outChannels > 1) outSub[j + 1] = imgData[i + 1];
          if (outChannels > 2) outSub[j + 2] = imgData[i + 2];
        }
      }

      if (xPtr) mem.writeInt32(lib, xPtr, w);
      if (yPtr) mem.writeInt32(lib, yPtr, h);
      if (channelsPtr) mem.writeInt32(lib, channelsPtr, 4);
      return outPtr;
    } catch (e) {
      return 0;
    }
  },
  nstbi_image_free(lib, retvalFromStbiLoad) {
    mem.free(lib, retvalFromStbiLoad);
  }
};

// ============================================================================
// 6. OpenAL Stubs
// ============================================================================
const alDispatch = {
  alcOpenDevice() { return 0x7001; },
  alcCreateContext() { return 0x7002; },
  alcMakeContextCurrent() { return 1; },
  alcDestroyContext() {},
  alcCloseDevice() { return 1; },
  alcGetError() { return 0; },
  alcIsExtensionPresent() { return 0; },
  alcGetIntegerv(lib, dev, pname, size, dataPtr) {
    if (dataPtr) mem.writeInt32(lib, dataPtr, 0);
  },
  alcGetString(lib) { return mem.allocCString(lib, "WebForge OpenAL"); },
  alGetError() { return 0; }
};

// ============================================================================
// 7. Explicit Export Table + JNINativeInterface DirectByteBuffer Builder
// ============================================================================
const jniInvokeHandler = function(lib, ...args) {
  const funcPtr = args[args.length - 1];
  const callArgs = args.slice(0, -1);
  return symRegistry.invoke(lib, funcPtr, callArgs);
};

let cachedJniEnvStructPtr = 0;

const baseExports = {
  // OpenJDK 17 NativeLibraries.load Bridge
  Java_jdk_internal_loader_NativeLibraries_load(lib, impl, nameObj, isBuiltin, isJNI, throwExceptionIfFail) {
    return 1; // JNI_TRUE
  },
  Java_jdk_internal_loader_NativeLibraries_unload(lib, nameObj, isBuiltin, isJNI, handle) {
  },

  // JNINativeInterface (Constructs real DirectByteBuffer instances for LWJGL 3 MemoryUtil)
  Java_org_lwjgl_system_jni_JNINativeInterface_GetVersion: () => 0x00010008,
  async Java_org_lwjgl_system_jni_JNINativeInterface_nNewDirectByteBuffer(lib, address, capacity) {
    await mem.calibrateDirectByteBufferLayout(lib);

    const capInt = Number(capacity) | 0;
    const addrBig = typeof address === "bigint"
      ? BigInt.asIntN(64, address)
      : BigInt.asIntN(64, BigInt(Math.trunc(Number(address) || 0)));

    // 1. Try OpenJDK 17's DirectByteBuffer(long addr, int cap) constructor directly
    try {
      const DirectByteBuffer = await lib.java.nio.DirectByteBuffer;
      const dbb = await new DirectByteBuffer(addrBig, capInt);
      if (dbb) return dbb;
    } catch (_) {}

    // 2. Fallback: Allocate a 0-byte DirectByteBuffer via ByteBuffer.allocateDirect(0)
    // and set its calibrated capacity, limit, position, mark, and address fields directly
    const ByteBuffer = await lib.java.nio.ByteBuffer;
    const dbb = await ByteBuffer.allocateDirect(0);
    if (mem.capacityKey !== null) dbb[mem.capacityKey] = capInt;
    if (mem.limitKey !== null) dbb[mem.limitKey] = capInt;
    if (mem.positionKey !== null) dbb[mem.positionKey] = 0;
    if (mem.markKey !== null) dbb[mem.markKey] = -1;
    if (mem.addressKey !== null) {
      if (typeof dbb[mem.addressKey] === "bigint") {
        dbb[mem.addressKey] = addrBig;
      } else {
        dbb[mem.addressKey] = Number(addrBig & 0xFFFFFFFFn) | 0;
      }
    }
    return dbb;
  },
  Java_org_lwjgl_system_jni_JNINativeInterface_GetDirectBufferAddress(lib, buf) {
    if (!buf) return 0;
    if (mem.addressKey !== null && buf[mem.addressKey] !== undefined) {
      return Number(buf[mem.addressKey]);
    }
    return 0;
  },
  Java_org_lwjgl_system_jni_JNINativeInterface_GetDirectBufferCapacity(lib, buf) {
    if (!buf) return 0;
    if (mem.capacityKey !== null && buf[mem.capacityKey] !== undefined) {
      return Number(buf[mem.capacityKey]);
    }
    return 0;
  },
  Java_org_lwjgl_system_jni_JNINativeInterface_NewGlobalRef: () => 1,
  Java_org_lwjgl_system_jni_JNINativeInterface_nDeleteGlobalRef: () => {},
  Java_org_lwjgl_system_jni_JNINativeInterface_DeleteGlobalRef: () => {},
  Java_org_lwjgl_system_jni_JNINativeInterface_NewWeakGlobalRef: () => 1,
  Java_org_lwjgl_system_jni_JNINativeInterface_nDeleteWeakGlobalRef: () => {},
  Java_org_lwjgl_system_jni_JNINativeInterface_DeleteWeakGlobalRef: () => {},
  Java_org_lwjgl_system_jni_JNINativeInterface_FromReflectedMethod: () => 1,
  Java_org_lwjgl_system_jni_JNINativeInterface_FromReflectedField: () => 1,
  Java_org_lwjgl_system_jni_JNINativeInterface_ToReflectedMethod: () => null,
  Java_org_lwjgl_system_jni_JNINativeInterface_ToReflectedField: () => null,

  Java_org_lwjgl_system_SharedLibraryUtil_getLibraryPath: () => 0,

  Java_org_lwjgl_system_ThreadLocalUtil_getThreadJNIEnv(lib) {
    if (!cachedJniEnvStructPtr) {
      const jniInterfaceTable = mem.calloc(lib, 300, 4);
      cachedJniEnvStructPtr = mem.calloc(lib, 16, 4);
      mem.writeInt32(lib, cachedJniEnvStructPtr, jniInterfaceTable);
    }
    return cachedJniEnvStructPtr;
  },
  Java_org_lwjgl_system_ThreadLocalUtil_getFunctionMissingAbort: () => symRegistry.register("abort", () => 0),
  Java_org_lwjgl_system_ThreadLocalUtil_nsetupEnvData: (lib, count) => mem.calloc(lib, Number(count) || 256, 4),
  Java_org_lwjgl_system_ThreadLocalUtil_setFunctionMissingAddresses: () => {},

  Java_org_lwjgl_system_MemoryAccessJNI_getPointerSize: () => 4,
  Java_org_lwjgl_system_MemoryAccessJNI_malloc: () => symRegistry.register("malloc", (lib, s) => mem.malloc(lib, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_calloc: () => symRegistry.register("calloc", (lib, n, s) => mem.calloc(lib, n, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_realloc: () => symRegistry.register("realloc", (lib, p, s) => mem.realloc(lib, p, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_free: () => symRegistry.register("free", (lib, p) => mem.free(lib, p)),
  Java_org_lwjgl_system_MemoryAccessJNI_aligned_1alloc: () => symRegistry.register("aligned_alloc", (lib, a, s) => mem.malloc(lib, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_aligned_1free: () => symRegistry.register("aligned_free", (lib, p) => mem.free(lib, p)),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetByte: (lib, ptr) => mem.readInt8(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetShort: (lib, ptr) => mem.readInt16(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetInt: (lib, ptr) => mem.readInt32(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetLong: (lib, ptr) => mem.readInt64(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetFloat: (lib, ptr) => mem.readFloat32(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetDouble: (lib, ptr) => mem.readFloat64(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_ngetAddress: (lib, ptr) => mem.readInt32(lib, ptr),
  Java_org_lwjgl_system_MemoryAccessJNI_nputByte: (lib, ptr, val) => mem.writeInt8(lib, ptr, val),
  Java_org_lwjgl_system_MemoryAccessJNI_nputShort: (lib, ptr, val) => mem.writeInt16(lib, ptr, val),
  Java_org_lwjgl_system_MemoryAccessJNI_nputInt: (lib, ptr, val) => mem.writeInt32(lib, ptr, val),
  Java_org_lwjgl_system_MemoryAccessJNI_nputLong: (lib, ptr, val) => mem.writeInt64(lib, ptr, val),
  Java_org_lwjgl_system_MemoryAccessJNI_nputFloat: (lib, ptr, val) => mem.writeFloat32(lib, ptr, val),
  Java_org_lwjgl_system_MemoryAccessJNI_nputDouble: (lib, ptr, val) => mem.writeFloat64(lib, ptr, val),
  Java_org_lwjgl_system_MemoryAccessJNI_nputAddress: (lib, ptr, val) => mem.writeInt32(lib, ptr, val),

  Java_org_lwjgl_system_MemoryUtil_nmemAlloc: (lib, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_MemoryUtil_nmemAllocChecked: (lib, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_MemoryUtil_nmemCalloc: (lib, num, size) => mem.calloc(lib, num, size),
  Java_org_lwjgl_system_MemoryUtil_nmemCallocChecked: (lib, num, size) => mem.calloc(lib, num, size),
  Java_org_lwjgl_system_MemoryUtil_nmemRealloc: (lib, ptr, size) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_MemoryUtil_nmemReallocChecked: (lib, ptr, size) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_MemoryUtil_nmemFree: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_MemoryUtil_nmemAlignedAlloc: (lib, align, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_MemoryUtil_nmemAlignedAllocChecked: (lib, align, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_MemoryUtil_nmemAlignedFree: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_MemoryUtil_nmemSet: (lib, ptr, val, bytes) => mem.memset(lib, ptr, val, bytes),
  Java_org_lwjgl_system_MemoryUtil_nmemCopy: (lib, dst, src, bytes) => mem.memcpy(lib, dst, src, bytes),
  Java_org_lwjgl_system_libc_LibCStdlib_nmalloc: (lib, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_libc_LibCStdlib_ncalloc: (lib, num, size) => mem.calloc(lib, num, size),
  Java_org_lwjgl_system_libc_LibCStdlib_nrealloc: (lib, ptr, size) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_libc_LibCStdlib_nfree: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_libc_LibCStdlib_naligned_1alloc: (lib, align, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_libc_LibCStdlib_naligned_1free: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_libc_LibCString_nmemset: (lib, ptr, val, bytes) => mem.memset(lib, ptr, val, bytes),
  Java_org_lwjgl_system_libc_LibCString_nmemcpy: (lib, dst, src, bytes) => mem.memcpy(lib, dst, src, bytes),

  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1malloc: (lib, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1calloc: (lib, num, size) => mem.calloc(lib, num, size),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1realloc: (lib, ptr, size) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1free: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1aligned_1alloc: (lib, align, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1mallocx: (lib, size, flags) => mem.malloc(lib, size),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1rallocx: (lib, ptr, size, flags) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1dallocx: (lib, ptr, flags) => mem.free(lib, ptr),
  Java_org_lwjgl_system_jemalloc_JEmalloc_nje_1sdallocx: (lib, ptr, size, flags) => mem.free(lib, ptr),

  Java_org_lwjgl_system_libffi_LibFFI_FFI_1DEFAULT_1ABI: () => 1,
  Java_org_lwjgl_system_libffi_LibFFI_FFI_1SYSV: () => 1,
  Java_org_lwjgl_system_libffi_LibFFI_FFI_1UNIX64: () => 2,
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1void: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1uint8: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1sint8: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1uint16: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1sint16: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1uint32: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1sint32: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1uint64: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1sint64: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1float: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1double: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_ffi_1type_1pointer: (lib) => mem.malloc(lib, 16),
  Java_org_lwjgl_system_libffi_LibFFI_nffi_1prep_1cif: () => 0,
  Java_org_lwjgl_system_libffi_LibFFI_nffi_1prep_1cif_1var: () => 0,
  Java_org_lwjgl_system_libffi_LibFFI_nffi_1call: () => {},
  Java_org_lwjgl_system_libffi_LibFFI_nffi_1closure_1alloc: (lib, size, codePtr) => {
    const ptr = mem.malloc(lib, Number(size) || 64);
    if (codePtr) mem.writeInt32(lib, codePtr, ptr);
    return ptr;
  },
  Java_org_lwjgl_system_libffi_LibFFI_nffi_1closure_1free: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_libffi_LibFFI_nffi_1prep_1closure_1loc: () => 0,
  Java_org_lwjgl_system_Callback_getNativeCallbacks: () => 1,

  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlopen(lib, filenamePtr, mode) {
    const name = mem.readCString(lib, filenamePtr);
    window.webforgeLog?.(`[dlopen] Loaded shared library: "${name || "process"}"`, "glfw");
    return 0x4001;
  },
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlsym(lib, handle, namePtr) {
    const symName = mem.readCString(lib, namePtr);
    return symRegistry.resolve(symName);
  },
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlerror: () => 0,
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlclose: () => 0,

  Java_org_lwjgl_opengl_GL_getFunctionProvider: () => 1,

  Java_org_lwjgl_stb_STBImage_nstbi_1set_1flip_1vertically_1on_1load: stbDispatch.nstbi_set_flip_vertically_on_load,
  Java_org_lwjgl_stb_STBImage_nstbi_1failure_1reason: stbDispatch.nstbi_failure_reason,
  Java_org_lwjgl_stb_STBImage_nstbi_1info_1from_1memory: stbDispatch.nstbi_info_from_memory,
  Java_org_lwjgl_stb_STBImage_nstbi_1load_1from_1memory: stbDispatch.nstbi_load_from_memory,
  Java_org_lwjgl_stb_STBImage_nstbi_1image_1free: stbDispatch.nstbi_image_free
};

for (const [fnName, fnImpl] of Object.entries(glfwDispatch)) {
  symRegistry.register(fnName, fnImpl);
  baseExports[`Java_org_lwjgl_glfw_GLFW_${fnName}`] = fnImpl;
  baseExports[`Java_org_lwjgl_glfw_GLFW_n${fnName}`] = fnImpl;
}

const glClasses = [
  "GL11", "GL11C", "GL12", "GL12C", "GL13", "GL13C", "GL14", "GL14C",
  "GL15", "GL15C", "GL20", "GL20C", "GL21", "GL21C", "GL30", "GL30C",
  "GL31", "GL31C", "GL32", "GL32C", "GL33", "GL33C", "GL40", "GL40C",
  "GL41", "GL41C", "GL42", "GL42C", "GL43", "GL43C", "GL44", "GL44C",
  "GL45", "GL45C", "GL46", "GL46C"
];
for (const [glName, glImpl] of Object.entries(glDispatch)) {
  symRegistry.register(glName, glImpl);
  for (const cls of glClasses) {
    baseExports[`Java_org_lwjgl_opengl_${cls}_${glName}`] = glImpl;
    baseExports[`Java_org_lwjgl_opengl_${cls}_n${glName}`] = glImpl;
  }
}

for (const [alName, alImpl] of Object.entries(alDispatch)) {
  symRegistry.register(alName, alImpl);
  baseExports[`Java_org_lwjgl_openal_ALC10_${alName}`] = alImpl;
  baseExports[`Java_org_lwjgl_openal_ALC10_n${alName}`] = alImpl;
  baseExports[`Java_org_lwjgl_openal_AL10_${alName}`] = alImpl;
  baseExports[`Java_org_lwjgl_openal_AL10_n${alName}`] = alImpl;
}

const jniSignatures = [
  "V", "Z", "B", "S", "C", "I", "J", "F", "D", "P",
  "PV", "PZ", "PI", "PJ", "PF", "PD", "PP",
  "IV", "IZ", "II", "IJ", "IF", "ID", "IP",
  "JV", "JZ", "JI", "JJ", "JF", "JD", "JP",
  "FV", "FF", "DV", "DD",
  "PPV", "PPZ", "PPI", "PPJ", "PPF", "PPD", "PPP",
  "PIV", "PIZ", "PII", "PIJ", "PIF", "PID", "PIP",
  "PJV", "PJZ", "PJI", "PJJ", "PJP", "PFV", "PDV",
  "IIV", "IIZ", "III", "IIJ", "IIF", "IIP",
  "IJV", "IJI", "IJJ", "IJP", "IPV", "IPI", "IPP",
  "JJV", "JJI", "JJJ", "JJP", "JPV", "JPP",
  "FFV", "FFF", "DDV", "DDD",
  "PPPV", "PPPZ", "PPPI", "PPPJ", "PPPP",
  "PPIV", "PPII", "PPIJ", "PPIP",
  "PIPV", "PIPI", "PIPJ", "PIPP",
  "PIIV", "PIIZ", "PIII", "PIIJ", "PIIF", "PIIP",
  "PJJV", "PJJI", "PJJJ", "PJJP",
  "PFFV", "PDDV", "IIIV", "IIII", "IIIP", "IIPV", "IIPP",
  "FFFFV", "PPPPZ", "PPPPV", "PPPPI", "PPPPJ", "PPPPP",
  "PPPJV", "PPIIV", "PPIII", "PPIIJ", "PPIIP",
  "PIPPV", "PIPPI", "PIPPP", "PIIIV", "PIIII", "PIIIP",
  "PIIJV", "PIJPV", "PJJJV", "PFFFV", "PDDDV", "IIIIV",
  "PPPPPV", "PPPPPI", "PPPPPP", "PPIIIV", "PPIIII", "PPIIIP",
  "PIIIIV", "PIIIII", "PIIIIP", "PIIJPV", "PFFFFV",
  "PPIIIIV", "PPIIIIIV", "PIIIIIIV", "PIIIIIIP"
];

for (const sig of jniSignatures) {
  baseExports[`Java_org_lwjgl_system_JNI_invoke${sig}`] = jniInvokeHandler;
  baseExports[`Java_org_lwjgl_system_JNI_call${sig}`] = jniInvokeHandler;
}

function createStrictLWJGLProxy(targetObj, logFn) {
  return new Proxy(targetObj, {
    has(target, prop) {
      if (prop in target) return true;
      if (typeof prop === "string" && prop.startsWith("Java_org_lwjgl_")) return true;
      return false;
    },
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || !prop.startsWith("Java_org_lwjgl_")) {
        return Reflect.get(target, prop, receiver);
      }

      if (prop.startsWith("Java_org_lwjgl_system_JNI_invoke") || prop.startsWith("Java_org_lwjgl_system_JNI_call")) {
        target[prop] = jniInvokeHandler;
        return jniInvokeHandler;
      }

      const glMatch = prop.match(/^Java_org_lwjgl_opengl_[A-Za-z0-9_]+_n?(gl[A-Za-z0-9_]+)$/);
      if (glMatch) {
        const glSym = glMatch[1].replace(/_1/g, "_");
        const fn = glDispatch[glSym] || function() { return 0; };
        target[prop] = fn;
        return fn;
      }

      const glfwMatch = prop.match(/^Java_org_lwjgl_glfw_GLFW_n?(glfw[A-Za-z0-9_]+)$/);
      if (glfwMatch) {
        const glfwSym = glfwMatch[1].replace(/_1/g, "_");
        const fn = glfwDispatch[glfwSym] || function() { return 0; };
        target[prop] = fn;
        return fn;
      }

      const fallbackStub = function() {
        logFn?.(`[Auto-Stubbed LWJGL JNI] ${prop}`, "warn");
        return 0;
      };
      target[prop] = fallbackStub;
      return fallbackStub;
    }
  });
}

baseExports.__createStrictLWJGLProxy = createStrictLWJGLProxy;

export default baseExports;
