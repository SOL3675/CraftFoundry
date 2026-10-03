package dev.mch.fixture.client;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import dev.mch.fixture.CounterBlockEntity;
import dev.mch.fixture.CounterScreenHandler;
import dev.mch.fixture.FixtureMod;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ingame.HandledScreens;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;
public final class FixtureClient implements ClientModInitializer {
    @Override public void onInitializeClient() {
        HandledScreens.register(FixtureMod.COUNTER_SCREEN, CounterScreen::new);
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, access) -> dispatcher.register(
            ClientCommandManager.literal("fixture_client").then(ClientCommandManager.literal("state")
                .then(ClientCommandManager.argument("x", IntegerArgumentType.integer())
                    .then(ClientCommandManager.argument("y", IntegerArgumentType.integer())
                        .then(ClientCommandManager.argument("z", IntegerArgumentType.integer()).executes(context -> {
                            var pos = new BlockPos(IntegerArgumentType.getInteger(context, "x"), IntegerArgumentType.getInteger(context, "y"), IntegerArgumentType.getInteger(context, "z"));
                            var source = context.getSource();
                            var entity = source.getWorld().getBlockEntity(pos);
                            String counter = entity instanceof CounterBlockEntity fixture ? Integer.toString(fixture.value()) : "null";
                            var client = MinecraftClient.getInstance();
                            String guiCounter = source.getPlayer().currentScreenHandler instanceof CounterScreenHandler handler ? Integer.toString(handler.value()) : "null";
                            String screen = client.currentScreen instanceof CounterScreen ? "counter" : client.currentScreen == null ? "none" : "other";
                            source.sendFeedback(Text.literal("MCH_FIXTURE_CLIENT {\"counter\":" + counter + ",\"guiCounter\":" + guiCounter + ",\"screen\":\"" + screen + "\"}"));
                            return entity instanceof CounterBlockEntity ? 1 : 0;
                        })))))));
    }
}
