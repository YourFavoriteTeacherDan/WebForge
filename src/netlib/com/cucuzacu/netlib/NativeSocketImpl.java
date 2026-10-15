package com.cucuzacu.netlib;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.net.SocketException;
import java.net.SocketImpl;
import java.net.SocketOption;
import java.net.SocketOptions;
import java.net.StandardSocketOptions;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class NativeSocketImpl extends SocketImpl {

    private NativeSocketBridge bridge;
    private NativeInputStream in;
    private NativeOutputStream out;
    private int timeout = 0;
    private final Map<Integer, Object> localOptions = new HashMap<>();

    private static final Set<SocketOption<?>> SUPPORTED_OPTIONS;
    static {
        Set<SocketOption<?>> opts = new HashSet<>();
        opts.add(StandardSocketOptions.SO_KEEPALIVE);
        opts.add(StandardSocketOptions.SO_SNDBUF);
        opts.add(StandardSocketOptions.SO_RCVBUF);
        opts.add(StandardSocketOptions.SO_REUSEADDR);
        opts.add(StandardSocketOptions.SO_LINGER);
        opts.add(StandardSocketOptions.IP_TOS);
        opts.add(StandardSocketOptions.TCP_NODELAY);
        SUPPORTED_OPTIONS = Collections.unmodifiableSet(opts);
    }

    public NativeSocketImpl() {
        // Pre-populate sensible defaults required by Minecraft 1.20.1 Netty bootstrap
        localOptions.put(SocketOptions.TCP_NODELAY, Boolean.TRUE);
        localOptions.put(SocketOptions.SO_KEEPALIVE, Boolean.TRUE);
        localOptions.put(SocketOptions.SO_REUSEADDR, Boolean.TRUE);
        localOptions.put(SocketOptions.SO_SNDBUF, Integer.valueOf(65536));
        localOptions.put(SocketOptions.SO_RCVBUF, Integer.valueOf(65536));
        localOptions.put(SocketOptions.SO_LINGER, Integer.valueOf(-1));
        localOptions.put(SocketOptions.IP_TOS, Integer.valueOf(0));
        localOptions.put(SocketOptions.SO_TIMEOUT, Integer.valueOf(0));
    }

    @Override
    protected void create(boolean stream) throws IOException {
        int fdVal = NativeSocketBridge.nativeCreate(stream);
        this.bridge = new NativeSocketBridge(fdVal);
        this.in = new NativeInputStream(bridge);
        this.out = new NativeOutputStream(bridge);
    }

    @Override
    protected void connect(String host, int port) throws IOException {
        connect(new InetSocketAddress(host, port), timeout);
    }

    @Override
    protected void connect(InetAddress address, int port) throws IOException {
        connect(new InetSocketAddress(address, port), timeout);
    }

    @Override
    protected void connect(SocketAddress endpoint, int timeout) throws IOException {
        if (!(endpoint instanceof InetSocketAddress)) {
            throw new IllegalArgumentException("Unsupported address type: " + endpoint);
        }
        if (this.bridge == null) {
            create(true);
        }
        InetSocketAddress inetAddr = (InetSocketAddress) endpoint;
        String host = inetAddr.getHostString();
        int port = inetAddr.getPort();

        this.address = inetAddr.getAddress();
        this.port = port;

        NativeSocketBridge.nativeConnect(bridge.getFd(), host, port, timeout);
    }

    @Override
    protected void bind(InetAddress host, int port) throws IOException {
        if (this.bridge == null) {
            create(true);
        }
        this.localport = port;
        String hostAddr = (host != null) ? host.getHostAddress() : "0.0.0.0";
        NativeSocketBridge.nativeBind(bridge.getFd(), hostAddr, port);
    }

    @Override
    protected void listen(int backlog) throws IOException {
        if (this.bridge == null) return;
        NativeSocketBridge.nativeListen(bridge.getFd(), backlog);
    }

    @Override
    protected void accept(SocketImpl s) throws IOException {
        if (!(s instanceof NativeSocketImpl)) {
            throw new IllegalArgumentException("Target SocketImpl must be NativeSocketImpl");
        }
        NativeSocketImpl target = (NativeSocketImpl) s;
        int clientFd = NativeSocketBridge.nativeAccept(bridge.getFd(), target);
        target.bridge = new NativeSocketBridge(clientFd);
        target.in = new NativeInputStream(target.bridge);
        target.out = new NativeOutputStream(target.bridge);
    }

    @Override
    protected InputStream getInputStream() throws IOException {
        if (this.in == null && this.bridge != null) {
            this.in = new NativeInputStream(this.bridge);
        }
        return in;
    }

    @Override
    protected OutputStream getOutputStream() throws IOException {
        if (this.out == null && this.bridge != null) {
            this.out = new NativeOutputStream(this.bridge);
        }
        return out;
    }

    @Override
    protected int available() throws IOException {
        return (in != null) ? in.available() : 0;
    }

    @Override
    protected void close() throws IOException {
        if (bridge != null) {
            NativeSocketBridge.nativeClose(bridge.getFd());
        }
    }

    @Override
    protected void shutdownInput() throws IOException {
        if (bridge != null) {
            NativeSocketBridge.nativeShutdownInput(bridge.getFd());
        }
    }

    @Override
    protected void shutdownOutput() throws IOException {
        if (bridge != null) {
            NativeSocketBridge.nativeShutdownOutput(bridge.getFd());
        }
    }

    @Override
    protected boolean supportsUrgentData() {
        return true;
    }

    @Override
    protected void sendUrgentData(int data) throws IOException {
        if (bridge != null) {
            NativeSocketBridge.nativeSendUrgentData(bridge.getFd(), data);
        }
    }

    private static int mapStandardOptionToLegacyId(SocketOption<?> option) {
        if (option == StandardSocketOptions.TCP_NODELAY) return SocketOptions.TCP_NODELAY;
        if (option == StandardSocketOptions.SO_KEEPALIVE) return SocketOptions.SO_KEEPALIVE;
        if (option == StandardSocketOptions.SO_SNDBUF) return SocketOptions.SO_SNDBUF;
        if (option == StandardSocketOptions.SO_RCVBUF) return SocketOptions.SO_RCVBUF;
        if (option == StandardSocketOptions.SO_REUSEADDR) return SocketOptions.SO_REUSEADDR;
        if (option == StandardSocketOptions.SO_LINGER) return SocketOptions.SO_LINGER;
        if (option == StandardSocketOptions.IP_TOS) return SocketOptions.IP_TOS;
        return -1;
    }

    @Override
    public Set<SocketOption<?>> supportedOptions() {
        return SUPPORTED_OPTIONS;
    }

    @Override
    public <T> void setOption(SocketOption<T> name, T value) throws IOException {
        int optId = mapStandardOptionToLegacyId(name);
        if (optId != -1) {
            setOption(optId, value);
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> T getOption(SocketOption<T> name) throws IOException {
        int optId = mapStandardOptionToLegacyId(name);
        if (optId != -1) {
            return (T) getOption(optId);
        }
        return null;
    }

    @Override
    public void setOption(int optID, Object value) throws SocketException {
        if (optID == SocketOptions.SO_TIMEOUT && value instanceof Integer) {
            this.timeout = ((Integer) value).intValue();
        }
        localOptions.put(Integer.valueOf(optID), value);
        if (bridge != null) {
            try {
                NativeSocketBridge.nativeSetOption(bridge.getFd(), optID, value);
            } catch (IOException e) {
                SocketException se = new SocketException("Failed to set option: " + optID);
                se.initCause(e);
                throw se;
            }
        }
    }

    @Override
    public Object getOption(int optID) throws SocketException {
        if (optID == SocketOptions.SO_TIMEOUT) {
            return Integer.valueOf(this.timeout);
        }
        if (bridge != null) {
            try {
                Object nativeVal = NativeSocketBridge.nativeGetOption(bridge.getFd(), optID);
                if (nativeVal != null) {
                    return nativeVal;
                }
            } catch (IOException e) {
                // Fall back to cached local option map
            }
        }
        Object fallback = localOptions.get(Integer.valueOf(optID));
        return (fallback != null) ? fallback : Boolean.TRUE;
    }
}
