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
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLEnvironment;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.registries.DeferredRegister;
import java.util.function.Supplier;

@Mod("fixture")
public final class FixtureMod {
    public static final boolean BREAK_SYNC = FMLEnvironment.dist == Dist.DEDICATED_SERVER && Boolean.getBoolean("mch.fixture.breakSync");
    private static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks("fixture");
    private static final DeferredRegister.Items ITEMS = DeferredRegister.createItems("fixture");
    private static final DeferredRegister<BlockEntityType<?>> ENTITIES = DeferredRegister.create(Registries.BLOCK_ENTITY_TYPE, "fixture");
    private static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(Registries.MENU, "fixture");
    public static final Supplier<CounterBlock> COUNTER = BLOCKS.register("counter", () -> new CounterBlock(BlockBehaviour.Properties.of().strength(1.0f)));
    public static final Supplier<BlockEntityType<CounterBlockEntity>> COUNTER_ENTITY = ENTITIES.register("counter", () -> BlockEntityType.Builder.of(CounterBlockEntity::new, COUNTER.get()).build(null));
    public static final Supplier<MenuType<CounterScreenHandler>> COUNTER_SCREEN = MENUS.register("counter", () -> new MenuType<>(CounterScreenHandler::new, FeatureFlags.VANILLA_SET));

    public FixtureMod(IEventBus bus) {
        if (FMLEnvironment.dist == Dist.DEDICATED_SERVER && Boolean.getBoolean("mch.fixture.failStart")) throw new IllegalStateException("MCH_FIXTURE_INTENTIONAL_START_FAILURE");
        ITEMS.register("counter", () -> new BlockItem(COUNTER.get(), new Item.Properties()));
        BLOCKS.register(bus); ITEMS.register(bus); ENTITIES.register(bus); MENUS.register(bus);
        NeoForge.EVENT_BUS.addListener(FixtureMod::registerCommands);
    }
    private static void registerCommands(RegisterCommandsEvent event) {
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
