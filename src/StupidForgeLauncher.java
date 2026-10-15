import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import com.cucuzacu.netlib.NetLib;

/**
 * WebForge Universal Bootstrapper (Supports Forge 1.20.1, Vanilla 1.20.1,
 * Persistent IndexedDB Worlds in /files/game/saves, and Mod Syncing)
 */
public class StupidForgeLauncher {

    private static void ensureDirectory(String path) {
        try {
            File dir = new File(path);
            if (!dir.exists() && dir.mkdirs()) {
                System.out.println("[StupidForgeLauncher] Created persistent IndexedDB directory: " + dir.getAbsolutePath());
            }
        } catch (Throwable ignored) {}
    }

    private static void syncIndexedDBModsToGameDir() {
        File manifest = new File("/str/mods_list.txt");
        if (!manifest.exists()) return;

        try (BufferedReader reader = new BufferedReader(new FileReader(manifest))) {
            String modName;
            while ((modName = reader.readLine()) != null) {
                modName = modName.trim();
                if (modName.isEmpty()) continue;
                Path src = Paths.get("/str/mod_" + modName);
                Path dst = Paths.get("/files/game/mods/" + modName);
                if (Files.exists(src)) {
                    Files.copy(src, dst, StandardCopyOption.REPLACE_EXISTING);
                    System.out.println("[StupidForgeLauncher] Synced Mod to /files/game/mods/" + modName);
                }
            }
        } catch (Throwable t) {
            System.err.println("[StupidForgeLauncher] Warning syncing mods: " + t.getMessage());
        }
    }

    public static void main(String[] args) {
        System.out.println("[StupidForgeLauncher] Initializing WebForge 1.20.1 Runtime Environment...");

        // 1. Set critical JVM properties for Minecraft 1.20.1, Forge 47.x, and LWJGL 3.3.1
        System.setProperty("org.lwjgl.util.NoChecks", "true");
        System.setProperty("org.lwjgl.glfw.checkThread0", "false");
        System.setProperty("org.lwjgl.system.allocator", "system");
        System.setProperty("fml.earlyprogresswindow", "false");
        System.setProperty("fml.ignoreInvalidMinecraftCertificates", "true");
        System.setProperty("fml.ignorePatchDiscrepancies", "true");
        System.setProperty("java.awt.headless", "false");

        // 2. Initialize WebSocket Network Bridge (NetLib)
        try {
            NetLib.init();
        } catch (Throwable t) {
            System.err.println("[StupidForgeLauncher] NetLib init warning: " + t.getMessage());
        }

        // 3. Ensure persistent IndexedDB (/files/game) directories exist for Worlds, Saves, Mods, and Configs
        ensureDirectory("/files/game");
        ensureDirectory("/files/game/saves");
        ensureDirectory("/files/game/mods");
        ensureDirectory("/files/game/config");
        ensureDirectory("/files/game/resourcepacks");
        ensureDirectory("/files/assets");
        ensureDirectory("/files/assets/indexes");
        ensureDirectory("/files/assets/objects");

        // 4. Sync any mods mounted from IndexedDB into /files/game/mods
        syncIndexedDBModsToGameDir();

        // 5. Determine target main class and launch
        boolean hasLaunchTarget = false;
        for (String arg : args) {
            if ("--launchTarget".equals(arg)) {
                hasLaunchTarget = true;
                break;
            }
        }

        String[] candidateMainClasses = hasLaunchTarget
            ? new String[] {
                "cpw.mods.bootstraplauncher.BootstrapLauncher",
                "cpw.mods.modlauncher.Launcher",
                "net.minecraft.client.main.Main",
                "net.minecraft.launchwrapper.Launch"
              }
            : new String[] {
                "net.minecraft.client.main.Main",
                "cpw.mods.bootstraplauncher.BootstrapLauncher",
                "cpw.mods.modlauncher.Launcher",
                "net.minecraft.launchwrapper.Launch"
              };

        for (String className : candidateMainClasses) {
            try {
                Class<?> mainClass = Class.forName(className, true, Thread.currentThread().getContextClassLoader());
                Method mainMethod = mainClass.getMethod("main", String[].class);
                System.out.println("[StupidForgeLauncher] Handing execution to: " + className);
                mainMethod.invoke(null, (Object) args);
                return;
            } catch (ClassNotFoundException ignored) {
            } catch (Throwable t) {
                System.err.println("[StupidForgeLauncher] Exception while executing " + className + ":");
                t.printStackTrace();
                return;
            }
        }

        System.err.println("[StupidForgeLauncher] FATAL: None of the target main classes were found on the classpath!");
    }
}
