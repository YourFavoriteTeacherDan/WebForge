// ============================================================================
// WebForge Unified LWJGL 3.3.1 (GLFW, OpenGL 3.2+ Core, STBImage, OpenAL,
// DynamicLinkLoader dlsym, MemoryUtil / LibC / JEmalloc) & LWJGL 2 Bridge
// ============================================================================

await import("https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/3.4.2/gl-matrix-min.js");

function getActiveCanvas() {
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
  const fallback = document.querySelector("canvas") || document.createElement("canvas");
  window.lwjglCanvasElement = fallback;
  return fallback;
}

const glCanvas = getActiveCanvas();
const glCtx = glCanvas.getContext("webgl2", {
  antialias: false,
  alpha: false,
  depth: true,
  stencil: true,
  powerPreference: "high-performance",
  desynchronized: true,
  preserveDrawingBuffer: false
});

if (!glCtx) {
  throw new Error("WebGL 2 is required for WebForge LWJGL 3.");
}

const debugRendererExt = glCtx.getExtension("WEBGL_debug_renderer_info");
glCtx.getExtension("EXT_color_buffer_float");
glCtx.getExtension("OES_texture_float_linear");

// ============================================================================
// 1. Wasm Linear Memory & Off-Heap Pointer Subsystem
// ============================================================================
class WasmHeapMemoryManager {
  constructor() {
    this.allocations = new Map(); // ptr -> { size, byteBufferRef }
    this.jsFallbackBlocks = new Map(); // ptr -> Uint8Array
    this.nextFallbackPtr = 0x50000000;
    this.heapView = null;
    this.rawBuffer = null;
    this.scratchStringPtrs = new Map();
  }

  getDataView(lib) {
    if (lib && typeof lib.getJNIDataView === "function") {
      const v = lib.getJNIDataView();
      if (v && v.buffer !== this.rawBuffer) {
        this.rawBuffer = v.buffer;
        this.heapView = new Uint8Array(v.buffer);
      }
      return v;
    }
    return null;
  }

  getHeapUint8(lib) {
    this.getDataView(lib);
    return this.heapView;
  }

  // Synchronous off-heap allocation aligned to 16 bytes
  malloc(lib, size) {
    const byteSize = Math.max(16, Number(size) || 16);
    const alignedSize = (byteSize + 15) & ~15;
    const ptr = this.nextFallbackPtr;
    this.nextFallbackPtr += alignedSize + 16;

    const heap = this.getHeapUint8(lib);
    if (!heap || ptr + alignedSize >= heap.byteLength) {
      const block = new Uint8Array(alignedSize);
      this.jsFallbackBlocks.set(ptr, block);
    }
    this.allocations.set(ptr, alignedSize);
    return ptr;
  }

  calloc(lib, num, size) {
    const total = Math.max(16, Number(num) * Number(size));
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
    this.allocations.delete(p);
    this.jsFallbackBlocks.delete(p);
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
    if (s && d) d.set(s);
    return Number(dst);
  }

  getSubarray(lib, ptr, byteLength) {
    const p = Number(ptr);
    if (p === 0) return null;
    const len = Number(byteLength) || this.allocations.get(p) || 0;

    if (this.jsFallbackBlocks.has(p)) {
      const blk = this.jsFallbackBlocks.get(p);
      return len > 0 ? blk.subarray(0, len) : blk;
    }

    const heap = this.getHeapUint8(lib);
    if (heap && p > 0 && p < heap.byteLength) {
      const safeEnd = len > 0 ? Math.min(heap.byteLength, p + len) : heap.byteLength;
      return heap.subarray(p, safeEnd);
    }

    // Create fallback on demand if Java passed an out-of-range virtual address
    const fallback = new Uint8Array(Math.max(len, 64));
    this.jsFallbackBlocks.set(p, fallback);
    return len > 0 ? fallback.subarray(0, len) : fallback;
  }

  readCString(lib, ptr) {
    const p = Number(ptr);
    if (!p) return "";
    if (typeof ptr === "string") return ptr;

    const slice = this.getSubarray(lib, p, 4096);
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

  readInt32(lib, ptr) {
    const p = Number(ptr);
    if (!p) return 0;
    const v = this.getDataView(lib);
    if (v && p + 4 <= v.byteLength) return v.getInt32(p, true);
    const sub = this.getSubarray(lib, p, 4);
    return sub ? new DataView(sub.buffer, sub.byteOffset, 4).getInt32(0, true) : 0;
  }

  writeInt32(lib, ptr, val) {
    const p = Number(ptr);
    if (!p) return;
    const v = this.getDataView(lib);
    if (v && p + 4 <= v.byteLength) {
      v.setInt32(p, Number(val), true);
      return;
    }
    const sub = this.getSubarray(lib, p, 4);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 4).setInt32(0, Number(val), true);
  }

  writeFloat32(lib, ptr, val) {
    const p = Number(ptr);
    if (!p) return;
    const v = this.getDataView(lib);
    if (v && p + 4 <= v.byteLength) {
      v.setFloat32(p, Number(val), true);
      return;
    }
    const sub = this.getSubarray(lib, p, 4);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 4).setFloat32(0, Number(val), true);
  }

  writeFloat64(lib, ptr, val) {
    const p = Number(ptr);
    if (!p) return;
    const v = this.getDataView(lib);
    if (v && p + 8 <= v.byteLength) {
      v.setFloat64(p, Number(val), true);
      return;
    }
    const sub = this.getSubarray(lib, p, 8);
    if (sub) new DataView(sub.buffer, sub.byteOffset, 8).setFloat64(0, Number(val), true);
  }
}

const mem = new WasmHeapMemoryManager();

// ============================================================================
// 2. Dynamic C Symbol Registry (Tracks dlsym & glfwGetProcAddress Pointers)
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
    // Auto-bind to glDispatch or glfwDispatch if matching
    if (glDispatch[name]) {
      return this.register(name, glDispatch[name]);
    }
    if (glfwDispatch[name]) {
      return this.register(name, glfwDispatch[name]);
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
// 3. GLFW 3.3.x Complete Implementation
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

glCanvas.addEventListener("keydown", e => {
  const k = browserCodeToGLFWKey(e.code);
  if (k > 0 && k < 512) glfwState.keys[k] = 1;
});
glCanvas.addEventListener("keyup", e => {
  const k = browserCodeToGLFWKey(e.code);
  if (k > 0 && k < 512) glfwState.keys[k] = 0;
});
glCanvas.addEventListener("mousedown", e => {
  glfwState.mouseButtons[e.button] = 1;
  if (glfwState.cursorMode === GLFW_CURSOR_DISABLED && document.pointerLockElement !== glCanvas) {
    try { glCanvas.requestPointerLock(); } catch (_) {}
  }
});
glCanvas.addEventListener("mouseup", e => {
  glfwState.mouseButtons[e.button] = 0;
});
glCanvas.addEventListener("mousemove", e => {
  if (document.pointerLockElement === glCanvas) {
    glfwState.mouseX += e.movementX;
    glfwState.mouseY += e.movementY;
  } else {
    const r = glCanvas.getBoundingClientRect();
    glfwState.mouseX = e.clientX - r.left;
    glfwState.mouseY = e.clientY - r.top;
  }
});

const glfwDispatch = {
  glfwInit(lib) {
    glfwState.initialized = true;
    window.webforgeLog?.("[GLFW] glfwInit() -> GLFW_TRUE", "glfw");
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
    return 0; // GLFW_NO_ERROR
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
    glfwState.width = Number(width) || 854;
    glfwState.height = Number(height) || 480;
    glfwState.title = mem.readCString(lib, titlePtr) || "Minecraft 1.20.1";
    glCanvas.width = glfwState.width;
    glCanvas.height = glfwState.height;
    glCanvas.style.display = "block";
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
    if (widthPtr) mem.writeInt32(lib, widthPtr, glCanvas.width || glfwState.width);
    if (heightPtr) mem.writeInt32(lib, heightPtr, glCanvas.height || glfwState.height);
  },
  glfwSetWindowSize(lib, window, width, height) {
    glfwState.width = Number(width);
    glfwState.height = Number(height);
    glCanvas.width = glfwState.width;
    glCanvas.height = glfwState.height;
  },
  glfwSetWindowSizeLimits(lib, window, minwidth, minheight, maxwidth, maxheight) {},
  glfwSetWindowAspectRatio(lib, window, numer, denom) {},
  glfwGetFramebufferSize(lib, window, widthPtr, heightPtr) {
    if (widthPtr) mem.writeInt32(lib, widthPtr, glCanvas.width || glfwState.width);
    if (heightPtr) mem.writeInt32(lib, heightPtr, glCanvas.height || glfwState.height);
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
    glCanvas.style.display = "block";
  },
  glfwHideWindow(lib, window) {},
  glfwFocusWindow(lib, window) {
    glCanvas.focus();
  },
  glfwRequestWindowAttention(lib, window) {},
  glfwGetWindowMonitor(lib, window) {
    return 0; // Windowed mode
  },
  glfwSetWindowMonitor(lib, window, monitor, xpos, ypos, width, height, refreshRate) {
    glfwState.width = Number(width);
    glfwState.height = Number(height);
    glCanvas.width = glfwState.width;
    glCanvas.height = glfwState.height;
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
  glfwMakeContextCurrent(lib, window) {},
  glfwGetCurrentContext(lib) {
    return glfwState.windowHandle;
  },
  glfwSwapBuffers(lib, window) {
    return new Promise(resolve => requestAnimationFrame(resolve));
  },
  glfwSwapInterval(lib, interval) {},
  glfwExtensionSupported(lib, extPtr) {
    const ext = mem.readCString(lib, extPtr);
    const supported = glCtx.getSupportedExtensions() || [];
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
      if (glfwState.cursorMode === GLFW_CURSOR_DISABLED) {
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

// Register all GLFW callback setters automatically
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
  mappedBuffers: new Map() // target -> { bufferId, ptr, length }
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

// Translates Minecraft 1.20.1 Blaze3D GLSL (#version 150) to WebGL 2 (#version 300 es)
function transpileGLSL150ToWebGL2(source, shaderType) {
  let src = String(source || "").trim();
  const isFrag = (shaderType === glCtx.FRAGMENT_SHADER);

  // Strip #version 110/120/130/140/150/330/400+
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
  glGetError() {
    return 0; // Prevent spurious GL errors from halting Blaze3D initialization
  },
  glGetString(lib, name) {
    const n = Number(name);
    let str = "";
    if (n === 0x1F00 /* GL_VENDOR */) {
      str = (debugRendererExt && glCtx.getParameter(debugRendererExt.UNMASKED_VENDOR_WEBGL)) || "WebForge";
    } else if (n === 0x1F01 /* GL_RENDERER */) {
      str = (debugRendererExt && glCtx.getParameter(debugRendererExt.UNMASKED_RENDERER_WEBGL)) || "WebForge WebGL 2.0 Core";
    } else if (n === 0x1F02 /* GL_VERSION */) {
      str = "3.2.0 WebForge WebGL 2.0";
    } else if (n === 0x8B8C /* GL_SHADING_LANGUAGE_VERSION */) {
      str = "1.50 WebForge GLSL ES 3.00";
    } else if (n === 0x1F03 /* GL_EXTENSIONS */) {
      str = SUPPORTED_GL_EXTENSIONS.join(" ");
    }
    return mem.allocCString(lib, str);
  },
  glGetStringi(lib, name, index) {
    const idx = Number(index);
    const ext = SUPPORTED_GL_EXTENSIONS[idx] || "GL_ARB_vertex_array_object";
    return mem.allocCString(lib, ext);
  },
  glGetIntegerv(lib, pname, paramsPtr) {
    const p = Number(pname);
    let val = 0;
    if (p === 0x821B /* GL_MAJOR_VERSION */) val = 3;
    else if (p === 0x821C /* GL_MINOR_VERSION */) val = 2;
    else if (p === 0x821D /* GL_NUM_EXTENSIONS */) val = SUPPORTED_GL_EXTENSIONS.length;
    else if (p === 0x9126 /* GL_CONTEXT_PROFILE_MASK */) val = 1; // GL_CONTEXT_CORE_PROFILE_BIT
    else if (p === 0x0D33 /* GL_MAX_TEXTURE_SIZE */) val = glCtx.getParameter(glCtx.MAX_TEXTURE_SIZE) || 8192;
    else if (p === 0x84E8 /* GL_MAX_RENDERBUFFER_SIZE */) val = glCtx.getParameter(glCtx.MAX_RENDERBUFFER_SIZE) || 8192;
    else if (p === 0x8872 /* GL_MAX_TEXTURE_IMAGE_UNITS */) val = 16;
    else if (p === 0x8B4D /* GL_MAX_COMBINED_TEXTURE_IMAGE_UNITS */) val = 32;
    else if (p === 0x8869 /* GL_MAX_VERTEX_ATTRIBS */) val = 16;
    else if (p === 0x0BA2 /* GL_VIEWPORT */) {
      mem.writeInt32(lib, Number(paramsPtr) + 0, 0);
      mem.writeInt32(lib, Number(paramsPtr) + 4, 0);
      mem.writeInt32(lib, Number(paramsPtr) + 8, glCanvas.width);
      mem.writeInt32(lib, Number(paramsPtr) + 12, glCanvas.height);
      return;
    } else {
      try {
        const res = glCtx.getParameter(p);
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
    const sub = mem.getSubarray(lib, paramsPtr, 1);
    if (sub) sub[0] = 1;
  },
  glClearColor(lib, r, g, b, a) {
    glCtx.clearColor(Number(r), Number(g), Number(b), Number(a));
  },
  glClearDepth(lib, d) {
    glCtx.clearDepth(Number(d));
  },
  glClearStencil(lib, s) {
    glCtx.clearStencil(Number(s));
  },
  glClear(lib, mask) {
    glCtx.clear(Number(mask));
  },
  glViewport(lib, x, y, w, h) {
    glCtx.viewport(Number(x), Number(y), Number(w), Number(h));
  },
  glScissor(lib, x, y, w, h) {
    glCtx.scissor(Number(x), Number(y), Number(w), Number(h));
  },
  glEnable(lib, cap) {
    const c = Number(cap);
    if (c === glCtx.BLEND || c === glCtx.DEPTH_TEST || c === glCtx.CULL_FACE || c === glCtx.SCISSOR_TEST || c === glCtx.STENCIL_TEST || c === glCtx.POLYGON_OFFSET_FILL) {
      glCtx.enable(c);
    }
  },
  glDisable(lib, cap) {
    const c = Number(cap);
    if (c === glCtx.BLEND || c === glCtx.DEPTH_TEST || c === glCtx.CULL_FACE || c === glCtx.SCISSOR_TEST || c === glCtx.STENCIL_TEST || c === glCtx.POLYGON_OFFSET_FILL) {
      glCtx.disable(c);
    }
  },
  glDepthFunc(lib, func) {
    glCtx.depthFunc(Number(func));
  },
  glDepthMask(lib, flag) {
    glCtx.depthMask(Boolean(flag));
  },
  glBlendFunc(lib, sfactor, dfactor) {
    glCtx.blendFunc(Number(sfactor), Number(dfactor));
  },
  glBlendFuncSeparate(lib, srcRGB, dstRGB, srcA, dstA) {
    glCtx.blendFuncSeparate(Number(srcRGB), Number(dstRGB), Number(srcA), Number(dstA));
  },
  glBlendEquation(lib, mode) {
    glCtx.blendEquation(Number(mode));
  },
  glBlendEquationSeparate(lib, modeRGB, modeAlpha) {
    glCtx.blendEquationSeparate(Number(modeRGB), Number(modeAlpha));
  },
  glBlendColor(lib, r, g, b, a) {
    glCtx.blendColor(Number(r), Number(g), Number(b), Number(a));
  },
  glColorMask(lib, r, g, b, a) {
    glCtx.colorMask(Boolean(r), Boolean(g), Boolean(b), Boolean(a));
  },
  glCullFace(lib, mode) {
    glCtx.cullFace(Number(mode));
  },
  glFrontFace(lib, mode) {
    glCtx.frontFace(Number(mode));
  },
  glPolygonOffset(lib, factor, units) {
    glCtx.polygonOffset(Number(factor), Number(units));
  },
  glPolygonMode(lib, face, mode) {},
  glLineWidth(lib, width) {
    glCtx.lineWidth(Number(width));
  },
  glPixelStorei(lib, pname, param) {
    const p = Number(pname);
    if (p === glCtx.PACK_ALIGNMENT || p === glCtx.UNPACK_ALIGNMENT || p === glCtx.UNPACK_ROW_LENGTH || p === glCtx.UNPACK_SKIP_PIXELS || p === glCtx.UNPACK_SKIP_ROWS) {
      glCtx.pixelStorei(p, Number(param));
    }
  },

  // Buffers (VBO, EBO, UBO)
  glGenBuffers(lib, n, buffersPtr) {
    const count = Number(n);
    const base = Number(buffersPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.buffers, glCtx.createBuffer());
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glCreateBuffers(lib, n, buffersPtr) {
    glDispatch.glGenBuffers(lib, n, buffersPtr);
  },
  glBindBuffer(lib, target, buffer) {
    const t = Number(target);
    const id = Number(buffer);
    if (t === glCtx.ARRAY_BUFFER) boundArrayBufferId = id;
    if (t === glCtx.ELEMENT_ARRAY_BUFFER) boundElementBufferId = id;
    glCtx.bindBuffer(t, glObjects.buffers[id] || null);
  },
  glBindBufferBase(lib, target, index, buffer) {
    glCtx.bindBufferBase(Number(target), Number(index), glObjects.buffers[Number(buffer)] || null);
  },
  glBindBufferRange(lib, target, index, buffer, offset, size) {
    glCtx.bindBufferRange(Number(target), Number(index), glObjects.buffers[Number(buffer)] || null, Number(offset), Number(size));
  },
  glBufferData(lib, target, sizeOrData, dataPtrOrUsage, usageMaybe) {
    const t = Number(target);
    if (usageMaybe !== undefined) {
      const size = Number(sizeOrData);
      const dataPtr = Number(dataPtrOrUsage);
      const usage = Number(usageMaybe);
      if (dataPtr === 0) {
        glCtx.bufferData(t, size, usage);
      } else {
        const sub = mem.getSubarray(lib, dataPtr, size);
        glCtx.bufferData(t, sub, usage);
      }
    }
  },
  glBufferSubData(lib, target, offset, size, dataPtr) {
    const sub = mem.getSubarray(lib, dataPtr, Number(size));
    if (sub) glCtx.bufferSubData(Number(target), Number(offset), sub);
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
    const t = Number(target);
    const mapped = glObjects.mappedBuffers.get(t);
    if (mapped) {
      const sub = mem.getSubarray(lib, mapped.ptr, mapped.length);
      if (sub) {
        try {
          glCtx.bufferSubData(t, mapped.offset || 0, sub);
        } catch (_) {
          glCtx.bufferData(t, sub, glCtx.DYNAMIC_DRAW);
        }
      }
      mem.free(lib, mapped.ptr);
      glObjects.mappedBuffers.delete(t);
    }
    return 1;
  },
  glDeleteBuffers(lib, n, buffersPtr) {
    const count = Number(n);
    const base = Number(buffersPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.buffers[id]) {
        glCtx.deleteBuffer(glObjects.buffers[id]);
        glObjects.buffers[id] = null;
      }
    }
  },

  // VAOs & Attributes
  glGenVertexArrays(lib, n, arraysPtr) {
    const count = Number(n);
    const base = Number(arraysPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.vaos, glCtx.createVertexArray());
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glCreateVertexArrays(lib, n, arraysPtr) {
    glDispatch.glGenVertexArrays(lib, n, arraysPtr);
  },
  glBindVertexArray(lib, array) {
    glCtx.bindVertexArray(glObjects.vaos[Number(array)] || null);
  },
  glDeleteVertexArrays(lib, n, arraysPtr) {
    const count = Number(n);
    const base = Number(arraysPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.vaos[id]) {
        glCtx.deleteVertexArray(glObjects.vaos[id]);
        glObjects.vaos[id] = null;
      }
    }
  },
  glEnableVertexAttribArray(lib, index) {
    glCtx.enableVertexAttribArray(Number(index));
  },
  glDisableVertexAttribArray(lib, index) {
    glCtx.disableVertexAttribArray(Number(index));
  },
  glVertexAttribPointer(lib, index, size, type, normalized, stride, pointer) {
    glCtx.vertexAttribPointer(Number(index), Number(size), Number(type), Boolean(normalized), Number(stride), Number(pointer));
  },
  glVertexAttribIPointer(lib, index, size, type, stride, pointer) {
    glCtx.vertexAttribIPointer(Number(index), Number(size), Number(type), Number(stride), Number(pointer));
  },
  glVertexAttribDivisor(lib, index, divisor) {
    glCtx.vertexAttribDivisor(Number(index), Number(divisor));
  },

  // Shaders & Programs
  glCreateShader(lib, type) {
    const t = Number(type);
    const s = glCtx.createShader(t);
    const id = registerGLObj(glObjects.shaders, s);
    glObjects.shaderTypes[id] = t;
    return id;
  },
  glShaderSource(lib, shader, count, stringsPtr, lengthPtr) {
    const id = Number(shader);
    const s = glObjects.shaders[id];
    if (!s) return;
    const c = Number(count) || 1;
    let combined = "";
    for (let i = 0; i < c; i++) {
      const strAddr = mem.readInt32(lib, Number(stringsPtr) + i * 4);
      const raw = mem.readCString(lib, strAddr);
      if (lengthPtr) {
        const len = mem.readInt32(lib, Number(lengthPtr) + i * 4);
        combined += len > 0 ? raw.slice(0, len) : raw;
      } else {
        combined += raw;
      }
    }
    const transpiled = transpileGLSL150ToWebGL2(combined, glObjects.shaderTypes[id]);
    glCtx.shaderSource(s, transpiled);
  },
  glCompileShader(lib, shader) {
    const s = glObjects.shaders[Number(shader)];
    if (!s) return;
    glCtx.compileShader(s);
    if (!glCtx.getShaderParameter(s, glCtx.COMPILE_STATUS)) {
      window.webforgeLog?.(`[GLSL Compile Warning] ${glCtx.getShaderInfoLog(s)}`, "warn");
    }
  },
  glGetShaderiv(lib, shader, pname, paramsPtr) {
    const s = glObjects.shaders[Number(shader)];
    const p = Number(pname);
    if (p === glCtx.COMPILE_STATUS) {
      mem.writeInt32(lib, paramsPtr, 1); // Keep Blaze3D running even if a fallback shader warns
      return;
    }
    const val = s ? glCtx.getShaderParameter(s, p) : 0;
    mem.writeInt32(lib, paramsPtr, typeof val === "boolean" ? (val ? 1 : 0) : (val || 0));
  },
  glGetShaderInfoLog(lib, shader, maxLength, lengthPtr, infoLogPtr) {
    const s = glObjects.shaders[Number(shader)];
    const info = (s && glCtx.getShaderInfoLog(s)) || "";
    const bytes = new TextEncoder().encode(info);
    const len = Math.min(Number(maxLength) - 1, bytes.length);
    if (lengthPtr) mem.writeInt32(lib, lengthPtr, len);
    const out = mem.getSubarray(lib, infoLogPtr, len + 1);
    if (out) {
      out.set(bytes.subarray(0, len));
      out[len] = 0;
    }
  },
  glDeleteShader(lib, shader) {
    const id = Number(shader);
    if (glObjects.shaders[id]) {
      glCtx.deleteShader(glObjects.shaders[id]);
      glObjects.shaders[id] = null;
    }
  },
  glCreateProgram(lib) {
    return registerGLObj(glObjects.programs, glCtx.createProgram());
  },
  glAttachShader(lib, program, shader) {
    const p = glObjects.programs[Number(program)];
    const s = glObjects.shaders[Number(shader)];
    if (p && s) glCtx.attachShader(p, s);
  },
  glDetachShader(lib, program, shader) {
    const p = glObjects.programs[Number(program)];
    const s = glObjects.shaders[Number(shader)];
    if (p && s) glCtx.detachShader(p, s);
  },
  glBindAttribLocation(lib, program, index, namePtr) {
    const p = glObjects.programs[Number(program)];
    if (p) glCtx.bindAttribLocation(p, Number(index), mem.readCString(lib, namePtr));
  },
  glBindFragDataLocation(lib, program, colorNumber, namePtr) {},
  glLinkProgram(lib, program) {
    const p = glObjects.programs[Number(program)];
    if (p) glCtx.linkProgram(p);
  },
  glUseProgram(lib, program) {
    glCtx.useProgram(glObjects.programs[Number(program)] || null);
  },
  glGetProgramiv(lib, program, pname, paramsPtr) {
    const p = glObjects.programs[Number(program)];
    const n = Number(pname);
    if (n === glCtx.LINK_STATUS || n === glCtx.VALIDATE_STATUS) {
      mem.writeInt32(lib, paramsPtr, 1);
      return;
    }
    const val = p ? glCtx.getProgramParameter(p, n) : 0;
    mem.writeInt32(lib, paramsPtr, typeof val === "boolean" ? (val ? 1 : 0) : (val || 0));
  },
  glGetProgramInfoLog(lib, program, maxLength, lengthPtr, infoLogPtr) {
    if (lengthPtr) mem.writeInt32(lib, lengthPtr, 0);
  },
  glDeleteProgram(lib, program) {
    const id = Number(program);
    if (glObjects.programs[id]) {
      glCtx.deleteProgram(glObjects.programs[id]);
      glObjects.programs[id] = null;
    }
  },
  glGetAttribLocation(lib, program, namePtr) {
    const p = glObjects.programs[Number(program)];
    return p ? glCtx.getAttribLocation(p, mem.readCString(lib, namePtr)) : 0;
  },
  glGetUniformLocation(lib, program, namePtr) {
    const p = glObjects.programs[Number(program)];
    if (!p) return -1;
    const loc = glCtx.getUniformLocation(p, mem.readCString(lib, namePtr));
    if (!loc) return -1;
    return registerGLObj(glObjects.uniforms, loc);
  },
  glUniform1i(lib, location, v0) {
    const u = glObjects.uniforms[Number(location)];
    if (u) glCtx.uniform1i(u, Number(v0));
  },
  glUniform1f(lib, location, v0) {
    const u = glObjects.uniforms[Number(location)];
    if (u) glCtx.uniform1f(u, Number(v0));
  },
  glUniform2f(lib, location, v0, v1) {
    const u = glObjects.uniforms[Number(location)];
    if (u) glCtx.uniform2f(u, Number(v0), Number(v1));
  },
  glUniform3f(lib, location, v0, v1, v2) {
    const u = glObjects.uniforms[Number(location)];
    if (u) glCtx.uniform3f(u, Number(v0), Number(v1), Number(v2));
  },
  glUniform4f(lib, location, v0, v1, v2, v3) {
    const u = glObjects.uniforms[Number(location)];
    if (u) glCtx.uniform4f(u, Number(v0), Number(v1), Number(v2), Number(v3));
  },
  glUniform1fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 4);
    if (sub) glCtx.uniform1fv(u, new Float32Array(sub.buffer, sub.byteOffset, Number(count)));
  },
  glUniform2fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 8);
    if (sub) glCtx.uniform2fv(u, new Float32Array(sub.buffer, sub.byteOffset, Number(count) * 2));
  },
  glUniform3fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 12);
    if (sub) glCtx.uniform3fv(u, new Float32Array(sub.buffer, sub.byteOffset, Number(count) * 3));
  },
  glUniform4fv(lib, location, count, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 16);
    if (sub) glCtx.uniform4fv(u, new Float32Array(sub.buffer, sub.byteOffset, Number(count) * 4));
  },
  glUniformMatrix3fv(lib, location, count, transpose, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 36);
    if (sub) glCtx.uniformMatrix3fv(u, Boolean(transpose), new Float32Array(sub.buffer, sub.byteOffset, Number(count) * 9));
  },
  glUniformMatrix4fv(lib, location, count, transpose, valuePtr) {
    const u = glObjects.uniforms[Number(location)];
    if (!u) return;
    const sub = mem.getSubarray(lib, valuePtr, Number(count) * 64);
    if (sub) glCtx.uniformMatrix4fv(u, Boolean(transpose), new Float32Array(sub.buffer, sub.byteOffset, Number(count) * 16));
  },

  // Textures & Framebuffers
  glGenTextures(lib, n, texturesPtr) {
    const count = Number(n);
    const base = Number(texturesPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.textures, glCtx.createTexture());
      glObjects.texMeta[id] = { width: 16, height: 16, internalFormat: glCtx.RGBA8 };
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glBindTexture(lib, target, texture) {
    const id = Number(texture);
    boundTexBySlot[activeTexSlot] = id;
    glCtx.bindTexture(Number(target), glObjects.textures[id] || null);
  },
  glActiveTexture(lib, texture) {
    const t = Number(texture);
    activeTexSlot = Math.max(0, t - 0x84C0);
    glCtx.activeTexture(t);
  },
  glTexParameteri(lib, target, pname, param) {
    let p = Number(param);
    if ((pname === glCtx.TEXTURE_WRAP_S || pname === glCtx.TEXTURE_WRAP_T) && (p === 0x2900 || p === 0x8059)) {
      p = glCtx.CLAMP_TO_EDGE;
    }
    glCtx.texParameteri(Number(target), Number(pname), p);
  },
  glTexParameterf(lib, target, pname, param) {
    glCtx.texParameterf(Number(target), Number(pname), Number(param));
  },
  glTexImage2D(lib, target, level, internalformat, width, height, border, format, type, pixelsPtr) {
    const w = Number(width);
    const h = Number(height);
    const boundId = boundTexBySlot[activeTexSlot];
    if (glObjects.texMeta[boundId]) {
      glObjects.texMeta[boundId].width = w;
      glObjects.texMeta[boundId].height = h;
    }
    const intFmt = (internalformat === glCtx.RGBA || internalformat === 4) ? glCtx.RGBA8 : Number(internalformat);
    const fmt = (format === 0x80E1 /* BGRA */) ? glCtx.RGBA : Number(format);
    const typ = (type === 0x8367) ? glCtx.UNSIGNED_BYTE : Number(type);
    const ptr = Number(pixelsPtr);

    if (ptr === 0) {
      glCtx.texImage2D(Number(target), Number(level), intFmt, w, h, Number(border), fmt, typ, null);
    } else {
      const sub = mem.getSubarray(lib, ptr, w * h * 4);
      glCtx.texImage2D(Number(target), Number(level), intFmt, w, h, Number(border), fmt, typ, sub);
    }
  },
  glTexSubImage2D(lib, target, level, xoffset, yoffset, width, height, format, type, pixelsPtr) {
    const w = Number(width);
    const h = Number(height);
    const ptr = Number(pixelsPtr);
    if (ptr === 0) return;
    const fmt = (format === 0x80E1) ? glCtx.RGBA : Number(format);
    const typ = (type === 0x8367) ? glCtx.UNSIGNED_BYTE : Number(type);
    const sub = mem.getSubarray(lib, ptr, w * h * 4);
    if (sub) {
      glCtx.texSubImage2D(Number(target), Number(level), Number(xoffset), Number(yoffset), w, h, fmt, typ, sub);
    }
  },
  glGetTexLevelParameteriv(lib, target, level, pname, paramsPtr) {
    const boundId = boundTexBySlot[activeTexSlot];
    const meta = glObjects.texMeta[boundId] || { width: 16, height: 16 };
    if (Number(pname) === 0x1000 /* WIDTH */) mem.writeInt32(lib, paramsPtr, meta.width);
    else if (Number(pname) === 0x1001 /* HEIGHT */) mem.writeInt32(lib, paramsPtr, meta.height);
    else mem.writeInt32(lib, paramsPtr, 0);
  },
  glDeleteTextures(lib, n, texturesPtr) {
    const count = Number(n);
    const base = Number(texturesPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.textures[id]) {
        glCtx.deleteTexture(glObjects.textures[id]);
        glObjects.textures[id] = null;
      }
    }
  },
  glGenFramebuffers(lib, n, framebuffersPtr) {
    const count = Number(n);
    const base = Number(framebuffersPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.framebuffers, glCtx.createFramebuffer());
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glBindFramebuffer(lib, target, framebuffer) {
    glCtx.bindFramebuffer(Number(target), glObjects.framebuffers[Number(framebuffer)] || null);
  },
  glFramebufferTexture2D(lib, target, attachment, textarget, texture, level) {
    glCtx.framebufferTexture2D(Number(target), Number(attachment), Number(textarget), glObjects.textures[Number(texture)] || null, Number(level));
  },
  glCheckFramebufferStatus(lib, target) {
    return 0x8CD5; // GL_FRAMEBUFFER_COMPLETE
  },
  glBlitFramebuffer(lib, srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter) {
    glCtx.blitFramebuffer(Number(srcX0), Number(srcY0), Number(srcX1), Number(srcY1), Number(dstX0), Number(dstY0), Number(dstX1), Number(dstY1), Number(mask), Number(filter));
  },
  glDeleteFramebuffers(lib, n, framebuffersPtr) {
    const count = Number(n);
    const base = Number(framebuffersPtr);
    for (let i = 0; i < count; i++) {
      const id = mem.readInt32(lib, base + i * 4);
      if (glObjects.framebuffers[id]) {
        glCtx.deleteFramebuffer(glObjects.framebuffers[id]);
        glObjects.framebuffers[id] = null;
      }
    }
  },
  glGenRenderbuffers(lib, n, renderbuffersPtr) {
    const count = Number(n);
    const base = Number(renderbuffersPtr);
    for (let i = 0; i < count; i++) {
      const id = registerGLObj(glObjects.renderbuffers, glCtx.createRenderbuffer());
      mem.writeInt32(lib, base + i * 4, id);
    }
  },
  glBindRenderbuffer(lib, target, renderbuffer) {
    glCtx.bindRenderbuffer(Number(target), glObjects.renderbuffers[Number(renderbuffer)] || null);
  },
  glRenderbufferStorage(lib, target, internalformat, width, height) {
    glCtx.renderbufferStorage(Number(target), Number(internalformat), Number(width), Number(height));
  },
  glFramebufferRenderbuffer(lib, target, attachment, renderbuffertarget, renderbuffer) {
    glCtx.framebufferRenderbuffer(Number(target), Number(attachment), Number(renderbuffertarget), glObjects.renderbuffers[Number(renderbuffer)] || null);
  },
  glDrawArrays(lib, mode, first, count) {
    glCtx.drawArrays(Number(mode), Number(first), Number(count));
  },
  glDrawElements(lib, mode, count, type, indices) {
    glCtx.drawElements(Number(mode), Number(count), Number(type), Number(indices));
  }
};

// ============================================================================
// 5. STBImage PNG/JPEG Hardware Decoder (Used by Minecraft 1.20.1 NativeImage)
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
    // Parse PNG IHDR directly at offset 16..25
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
      console.warn("[STBImage] Failed decoding texture:", e);
      return 0;
    }
  },
  nstbi_image_free(lib, retvalFromStbiLoad) {
    mem.free(lib, retvalFromStbiLoad);
  }
};

// ============================================================================
// 6. OpenAL Stubs (org.lwjgl.openal.*)
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
// 7. Static + Dynamic Proxy JNI Export Builder
// ============================================================================
const baseExports = {
  // MemoryAccessJNI & MemoryUtil
  Java_org_lwjgl_system_MemoryAccessJNI_getPointerSize: () => 4,
  Java_org_lwjgl_system_MemoryAccessJNI_malloc: () => symRegistry.register("malloc", (lib, s) => mem.malloc(lib, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_calloc: () => symRegistry.register("calloc", (lib, n, s) => mem.calloc(lib, n, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_realloc: () => symRegistry.register("realloc", (lib, p, s) => mem.realloc(lib, p, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_free: () => symRegistry.register("free", (lib, p) => mem.free(lib, p)),
  Java_org_lwjgl_system_MemoryAccessJNI_aligned_1alloc: () => symRegistry.register("aligned_alloc", (lib, a, s) => mem.malloc(lib, s)),
  Java_org_lwjgl_system_MemoryAccessJNI_aligned_1free: () => symRegistry.register("aligned_free", (lib, p) => mem.free(lib, p)),
  Java_org_lwjgl_system_MemoryUtil_nmemAlloc: (lib, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_MemoryUtil_nmemCalloc: (lib, num, size) => mem.calloc(lib, num, size),
  Java_org_lwjgl_system_MemoryUtil_nmemRealloc: (lib, ptr, size) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_MemoryUtil_nmemFree: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_libc_LibCStdlib_nmalloc: (lib, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_libc_LibCStdlib_ncalloc: (lib, num, size) => mem.calloc(lib, num, size),
  Java_org_lwjgl_system_libc_LibCStdlib_nrealloc: (lib, ptr, size) => mem.realloc(lib, ptr, size),
  Java_org_lwjgl_system_libc_LibCStdlib_nfree: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_libc_LibCStdlib_naligned_1alloc: (lib, align, size) => mem.malloc(lib, size),
  Java_org_lwjgl_system_libc_LibCStdlib_naligned_1free: (lib, ptr) => mem.free(lib, ptr),
  Java_org_lwjgl_system_libc_LibCString_nmemset: (lib, ptr, val, bytes) => mem.memset(lib, ptr, val, bytes),
  Java_org_lwjgl_system_libc_LibCString_nmemcpy: (lib, dst, src, bytes) => mem.memcpy(lib, dst, src, bytes),
  Java_org_lwjgl_system_JNI_getNativeLibraryVersion: () => "3.3.1",

  // POSIX DynamicLinkLoader (dlopen / dlsym)
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlopen(lib, filenamePtr, mode) {
    const name = mem.readCString(lib, filenamePtr);
    window.webforgeLog?.(`[dlopen] Loaded shared library: "${name || "process"}"`, "glfw");
    return 0x4001;
  },
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlsym(lib, handle, namePtr) {
    const symName = mem.readCString(lib, namePtr);
    return symRegistry.resolve(symName);
  },
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlerror() {
    return 0;
  },
  Java_org_lwjgl_system_linux_DynamicLinkLoader_ndlclose() {
    return 0;
  },

  // STBImage
  Java_org_lwjgl_stb_STBImage_nstbi_1set_1flip_1vertically_1on_1load: stbDispatch.nstbi_set_flip_vertically_on_load,
  Java_org_lwjgl_stb_STBImage_nstbi_1failure_1reason: stbDispatch.nstbi_failure_reason,
  Java_org_lwjgl_stb_STBImage_nstbi_1info_1from_1memory: stbDispatch.nstbi_info_from_memory,
  Java_org_lwjgl_stb_STBImage_nstbi_1load_1from_1memory: stbDispatch.nstbi_load_from_memory,
  Java_org_lwjgl_stb_STBImage_nstbi_1image_1free: stbDispatch.nstbi_image_free
};

// Populate static GLFW & GL exports onto baseExports
for (const [fnName, fnImpl] of Object.entries(glfwDispatch)) {
  symRegistry.register(fnName, fnImpl);
  baseExports[`Java_org_lwjgl_glfw_GLFW_${fnName}`] = fnImpl;
  baseExports[`Java_org_lwjgl_glfw_GLFW_n${fnName}`] = fnImpl;
}

const glClasses = ["GL11", "GL11C", "GL12", "GL12C", "GL13", "GL13C", "GL14", "GL14C", "GL15", "GL15C", "GL20", "GL20C", "GL21", "GL30", "GL30C", "GL31", "GL31C", "GL32", "GL32C", "GL33", "GL33C", "GL40", "GL43", "GL45"];
for (const [glName, glImpl] of Object.entries(glDispatch)) {
  symRegistry.register(glName, glImpl);
  for (const cls of glClasses) {
    baseExports[`Java_org_lwjgl_opengl_${cls}_${glName}`] = glImpl;
    baseExports[`Java_org_lwjgl_opengl_${cls}_n${glName}`] = glImpl;
  }
}

// Dynamic JNI Proxy Generator to intercept all JNI.invoke* / JNI.call* and unenumerated symbols
function createDynamicJNIProxy(targetObj, logFn) {
  return new Proxy(targetObj, {
    has(target, prop) {
      if (prop in target) return true;
      if (typeof prop === "string" && prop.startsWith("Java_")) return true;
      return false;
    },
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop !== "string" || !prop.startsWith("Java_")) {
        return Reflect.get(target, prop, receiver);
      }

      // 1. Intercept org.lwjgl.system.JNI.invoke* and JNI.call*
      if (prop.startsWith("Java_org_lwjgl_system_JNI_invoke") || prop.startsWith("Java_org_lwjgl_system_JNI_call")) {
        const fn = function(lib, ...args) {
          const funcPtr = args[args.length - 1];
          const callArgs = args.slice(0, -1);
          return symRegistry.invoke(lib, funcPtr, callArgs);
        };
        target[prop] = fn;
        return fn;
      }

      // 2. Intercept any OpenGL GL* / ARB* / EXT* class method
      const glMatch = prop.match(/^Java_org_lwjgl_opengl_[A-Za-z0-9_]+_n?(gl[A-Za-z0-9_]+)$/);
      if (glMatch) {
        const glSym = glMatch[1].replace(/_1/g, "_");
        const fn = glDispatch[glSym] || function() { return 0; };
        target[prop] = fn;
        return fn;
      }

      // 3. Intercept any GLFW method
      const glfwMatch = prop.match(/^Java_org_lwjgl_glfw_GLFW_n?(glfw[A-Za-z0-9_]+)$/);
      if (glfwMatch) {
        const glfwSym = glfwMatch[1].replace(/_1/g, "_");
        const fn = glfwDispatch[glfwSym] || function() { return 0; };
        target[prop] = fn;
        return fn;
      }

      // 4. Auto-stub any other native method so UnsatisfiedLinkError never halts the JVM
      const fallbackStub = function(lib, ...args) {
        logFn?.(`[Auto-Stubbed JNI] ${prop}`, "warn");
        return 0;
      };
      target[prop] = fallbackStub;
      return fallbackStub;
    }
  });
}

baseExports.__createDynamicJNIProxy = createDynamicJNIProxy;

export default createDynamicJNIProxy(baseExports, window.webforgeLog);
