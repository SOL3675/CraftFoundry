package dev.mch.fixture;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.api.EnvType;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.object.builder.v1.block.entity.FabricBlockEntityTypeBuilder;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.block.AbstractBlock;
import net.minecraft.block.entity.BlockEntityType;
import net.minecraft.command.argument.BlockPosArgumentType;
import net.minecraft.item.BlockItem;
import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.resource.featuretoggle.FeatureFlags;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.server.command.CommandManager;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

public final class FixtureMod implements ModInitializer {
    /** Opt-in regression controls affect dedicated servers only. */
    public static final boolean BREAK_SYNC = FabricLoader.getInstance().getEnvironmentType() == EnvType.SERVER
        && Boolean.getBoolean("mch.fixture.breakSync");
    public static final CounterBlock COUNTER = new CounterBlock(AbstractBlock.Settings.create().strength(1.0f));
    public static BlockEntityType<CounterBlockEntity> COUNTER_ENTITY;
    public static ScreenHandlerType<CounterScreenHandler> COUNTER_SCREEN;
    @Override public void onInitialize() {
        if (FabricLoader.getInstance().getEnvironmentType() == EnvType.SERVER && Boolean.getBoolean("mch.fixture.failStart")) {
            throw new IllegalStateException("MCH_FIXTURE_INTENTIONAL_START_FAILURE");
        }
        Registry.register(Registries.BLOCK, id("counter"), COUNTER);
        Registry.register(Registries.ITEM, id("counter"), new BlockItem(COUNTER, new Item.Settings()));
        COUNTER_ENTITY = Registry.register(Registries.BLOCK_ENTITY_TYPE, id("counter"), FabricBlockEntityTypeBuilder.create(CounterBlockEntity::new, COUNTER).build());
        COUNTER_SCREEN = Registry.register(Registries.SCREEN_HANDLER, id("counter"), new ScreenHandlerType<>(CounterScreenHandler::new, FeatureFlags.VANILLA_FEATURES));
        CommandRegistrationCallback.EVENT.register((dispatcher, access, environment) -> dispatcher.register(
            CommandManager.literal("fixture").requires(source -> source.hasPermissionLevel(2))
                .then(CommandManager.literal("state").then(CommandManager.argument("pos", BlockPosArgumentType.blockPos()).executes(context -> {
                    var pos = BlockPosArgumentType.getLoadedBlockPos(context, "pos");
                    var entity = context.getSource().getWorld().getBlockEntity(pos);
                    if (!(entity instanceof CounterBlockEntity counter)) throw new IllegalStateException("Expected fixture:counter at " + pos);
                    int value = counter.value();
                    context.getSource().sendFeedback(() -> Text.literal("MCH_FIXTURE_SERVER {\"counter\":" + value + "}"), false);
                    return value;
                })))));
    }
    public static Identifier id(String path) { return new Identifier("fixture", path); }
}
