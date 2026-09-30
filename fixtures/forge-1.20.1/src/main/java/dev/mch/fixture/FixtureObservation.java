package dev.mch.fixture;

import java.util.Optional;
import java.util.function.Consumer;
import net.minecraft.core.BlockPos;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.network.NetworkDirection;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.simple.SimpleChannel;

/** Relays an observation request only. Counter, menu and GUI state are read on the client. */
public final class FixtureObservation {
    private static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
        new ResourceLocation("fixture", "observation"), () -> "1", "1"::equals, "1"::equals);
    private static Consumer<BlockPos> clientObserver = pos -> { throw new IllegalStateException("Client observation handler is not registered"); };
    private record Request(BlockPos pos) { }
    public static void register() {
        CHANNEL.registerMessage(0, Request.class, (request, buffer) -> buffer.writeBlockPos(request.pos()),
            buffer -> new Request(buffer.readBlockPos()), (request, contextSupplier) -> {
                var context = contextSupplier.get();
                context.enqueueWork(() -> clientObserver.accept(request.pos()));
                context.setPacketHandled(true);
            }, Optional.of(NetworkDirection.PLAY_TO_CLIENT));
    }
    public static void setClientObserver(Consumer<BlockPos> observer) { clientObserver = observer; }
    public static void request(ServerPlayer player, BlockPos pos) { CHANNEL.send(PacketDistributor.PLAYER.with(() -> player), new Request(pos)); }
}
