import java.io.File;
import java.lang.reflect.Method;
import com.cucuzacu.netlib.NetLib;

/**
 * WebForge Universal Bootstrapper (Supports Forge 1.20.1, Vanilla 1.20.1, and Legacy LaunchWrapper)
 */
public class StupidForgeLauncher {

    private static void ensureDirectory(String path) {
        try {
            File dir = new File(path);
            if (!dir.exists() && dir.mkdirs()) {
                System.out.println("[StupidForgeLauncher] Created directory: " + dir.getAbsolutePath());
            }
        } catch (Throwable ignored) {}
    }

    public static void main(String[] args) {
        System.out.println("[StupidForgeLauncher] Initializing WebForge 1.20.1 Runtime Environment...");

        // 1. Set critical JVM properties for Minecraft 1.20.1, Forge 47.x, and LWJGL 3.3.1
        System.setProperty("org.lwjgl.util.NoChecks", "true");
        System.setProperty("org.lwjgl.glfw.checkThread0", "false");
        System.setProperty("org.lwjgl.system.allocator", "system");
        System.setProperty("fml.earlyprogresswindow", "false"); // Prevents Forge 1.20.1 from spawning a secondary GL thread
        System.setProperty("fml.ignoreInvalidMinecraftCertificates", "true");
        System.setProperty("fml.ignorePatchDiscrepancies", "true");
        System.setProperty("java.awt.headless", "false");

        // 2. Initialize WebSocket Network Bridge (NetLib)
        try {
            NetLib.init();
        } catch (Throwable t) {
            System.err.println("[StupidForgeLauncher] NetLib init warning: " + t.getMessage());
        }

        // 3. Ensure virtual filesystem directories exist
        ensureDirectory("/files/game");
        ensureDirectory("/files/game/mods");
        ensureDirectory("/files/game/config");
        ensureDirectory("/files/game/resourcepacks");
        ensureDirectory("/files/assets");
        ensureDirectory("/files/assets/indexes");
        ensureDirectory("/files/assets/objects");

        // 4. Determine whether "--launchTarget" was passed (Forge ModLauncher / BootstrapLauncher mode)
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
                // Try next candidate entry point
            } catch (Throwable t) {
                System.err.println("[StupidForgeLauncher] Exception while executing " + className + ":");
                t.printStackTrace();
                return;
            }
        }

        System.err.println("[StupidForgeLauncher] FATAL: None of the target main classes were found on the classpath!");
    }
}
