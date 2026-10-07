package dev.mch.fixture;

import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.coordinates.BlockPosArgument;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraft.world.level.block.Block;
import java.util.function.Supplier;

@Mod("fixture")
public final class FixtureMod {
    public static final boolean BREAK_SYNC = FMLEnvironment.dist == Dist.DEDICATED_SERVER && Boolean.getBoolean("mch.fixture.breakSync");
    private static final DeferredRegister<Block> BLOCKS = DeferredRegister.create(ForgeRegistries.BLOCKS, "fixture");
    private static final DeferredRegister<Item> ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, "fixture");
    private static final DeferredRegister<BlockEntityType<?>> ENTITIES = DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, "fixture");
    private static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(Registries.MENU, "fixture");
    public static final Supplier<CounterBlock> COUNTER = BLOCKS.register("counter", () -> new CounterBlock(BlockBehaviour.Properties.of().strength(1.0f)));
    public static final Supplier<BlockEntityType<CounterBlockEntity>> COUNTER_ENTITY = ENTITIES.register("counter", () -> BlockEntityType.Builder.of(CounterBlockEntity::new, COUNTER.get()).build(null));
    public static final Supplier<MenuType<CounterScreenHandler>> COUNTER_SCREEN = MENUS.register("counter", () -> new MenuType<>(CounterScreenHandler::new, FeatureFlags.VANILLA_SET));

    public FixtureMod() {
        IEventBus bus = FMLJavaModLoadingContext.get().getModEventBus();
        if (FMLEnvironment.dist == Dist.DEDICATED_SERVER && Boolean.getBoolean("mch.fixture.failStart")) throw new IllegalStateException("MCH_FIXTURE_INTENTIONAL_START_FAILURE");
        FixtureObservation.register();
        ITEMS.register("counter", () -> new BlockItem(COUNTER.get(), new Item.Properties()));
        BLOCKS.register(bus); ITEMS.register(bus); ENTITIES.register(bus); MENUS.register(bus);
        MinecraftForge.EVENT_BUS.addListener(FixtureMod::registerCommands);
    }
    private static void registerCommands(RegisterCommandsEvent event) {
        // Forge's pinned helper sends commands directly to the server, bypassing ChatScreen's local-command hook.
        event.getDispatcher().register(Commands.literal("fixture_client").requires(source -> source.getEntity() instanceof net.minecraft.server.level.ServerPlayer)
            .then(Commands.literal("state").then(Commands.argument("pos", BlockPosArgument.blockPos()).executes(context -> {
                var pos = BlockPosArgument.getLoadedBlockPos(context, "pos");
                FixtureObservation.request(context.getSource().getPlayerOrException(), pos);
                return 1;
            }))));
        event.getDispatcher().register(Commands.literal("fixture").requires(source -> source.hasPermission(2))
            .then(PersistenceFixture.commands())
            .then(Commands.literal("state").then(Commands.argument("pos", BlockPosArgument.blockPos()).executes(context -> {
                var pos = BlockPosArgument.getLoadedBlockPos(context, "pos");
                var entity = context.getSource().getLevel().getBlockEntity(pos);
                if (!(entity instanceof CounterBlockEntity counter)) throw new IllegalStateException("Expected fixture:counter at " + pos);
                int value = counter.value();
                context.getSource().sendSuccess(() -> Component.literal("MCH_FIXTURE_SERVER {\"counter\":" + value + "}"), false);
                return value;
            }))));
    }
}
