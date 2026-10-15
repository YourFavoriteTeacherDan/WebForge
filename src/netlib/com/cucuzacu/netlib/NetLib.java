// WebForge CheerpJ WebSocket Networking Library (Java 17 / Minecraft 1.20.1 Edition)

package com.cucuzacu.netlib;

import java.net.Socket;
import java.net.ServerSocket;

public class NetLib {

    private static boolean initialized = false;

    public static synchronized void init() {
        if (initialized) return;

        try {
            // Configure Netty 4.1.x (used by Minecraft 1.20.1) to avoid native epoll/Unsafe crashes in Wasm
            System.setProperty("java.net.preferIPv4Stack", "true");
            System.setProperty("io.netty.noUnsafe", "true");
            System.setProperty("io.netty.allocator.type", "unpooled");
            System.setProperty("io.netty.transport.noNative", "true");

            NativeSocketImplFactory factory = new NativeSocketImplFactory();

            try {
                Socket.setSocketImplFactory(factory);
            } catch (Throwable t) {
                System.err.println("[NetLib] Notice: SocketImplFactory already set or restricted: " + t.getMessage());
            }

            try {
                ServerSocket.setSocketFactory(factory);
            } catch (Throwable t) {
                System.err.println("[NetLib] Notice: ServerSocketFactory already set or restricted: " + t.getMessage());
            }

            initialized = true;
            System.out.println("[NetLib] WebForge 1.20.1 WebSocket Bridge installed successfully.");
        } catch (Throwable e) {
            System.err.println("[NetLib] Warning: Failed to install NetLib cleanly: " + e.getMessage());
            e.printStackTrace();
        }
    }
}
