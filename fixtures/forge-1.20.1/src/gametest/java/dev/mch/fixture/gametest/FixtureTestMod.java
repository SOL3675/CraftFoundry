package dev.mch.fixture.gametest;

import java.io.File;
import net.minecraft.gametest.framework.GlobalTestReporter;
import net.minecraft.gametest.framework.JUnitLikeTestReporter;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.server.ServerAboutToStartEvent;

/** Development-only test mod. No tests or reporter are included in the distribution JAR. */
@Mod("fixture_tests")
public final class FixtureTestMod {
    public FixtureTestMod() { MinecraftForge.EVENT_BUS.addListener(FixtureTestMod::reporter); }
    private static void reporter(ServerAboutToStartEvent event) {
        if (!Boolean.getBoolean("forge.gameTestServer")) return;
        String output = System.getProperty("mch.fixture.reportFile");
        if (output == null) throw new IllegalStateException("Missing explicit GameTest report destination");
        try {
            File file = new File(output); file.getParentFile().mkdirs();
            GlobalTestReporter.replaceWith(new JUnitLikeTestReporter(file));
        } catch (Exception error) { throw new IllegalStateException("Cannot configure real GameTest JUnit reporter", error); }
    }
}

