package dev.mch.fixture.client;

import com.mojang.brigadier.arguments.IntegerArgumentType;
import dev.mch.fixture.CounterBlockEntity;
import dev.mch.fixture.CounterScreenHandler;
import dev.mch.fixture.FixtureMod;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.fml.common.EventBusSubscriber;
import net.neoforged.neoforge.client.event.RegisterClientCommandsEvent;
import net.neoforged.neoforge.client.event.RegisterMenuScreensEvent;

@EventBusSubscriber(modid = "fixture", value = Dist.CLIENT)
public final class FixtureClient {
    @SubscribeEvent public static void commands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("fixture_client").then(Commands.literal("state")
            .then(Commands.argument("x", IntegerArgumentType.integer()).then(Commands.argument("y", IntegerArgumentType.integer())
                .then(Commands.argument("z", IntegerArgumentType.integer()).executes(context -> {
                    var pos = new BlockPos(IntegerArgumentType.getInteger(context, "x"), IntegerArgumentType.getInteger(context, "y"), IntegerArgumentType.getInteger(context, "z"));
                    var client = Minecraft.getInstance();
                    var entity = client.level == null ? null : client.level.getBlockEntity(pos);
                    String counter = entity instanceof CounterBlockEntity fixture ? Integer.toString(fixture.value()) : "null";
                    String guiCounter = client.player != null && client.player.containerMenu instanceof CounterScreenHandler handler ? Integer.toString(handler.value()) : "null";
                    String screen = client.screen instanceof CounterScreen ? "counter" : client.screen == null ? "none" : "other";
                    if (client.player != null) client.player.displayClientMessage(Component.literal("MCH_FIXTURE_CLIENT {\"counter\":" + counter + ",\"guiCounter\":" + guiCounter + ",\"screen\":\"" + screen + "\"}"), false);
                    return entity instanceof CounterBlockEntity ? 1 : 0;
                }))))));
    }
    @EventBusSubscriber(modid = "fixture", value = Dist.CLIENT, bus = EventBusSubscriber.Bus.MOD)
    public static final class ModEvents {
        @SubscribeEvent public static void screens(RegisterMenuScreensEvent event) { event.register(FixtureMod.COUNTER_SCREEN.get(), CounterScreen::new); }
    }
}
