package dev.mch.fixture;
import net.minecraft.server.command.ServerCommandSource;
import net.minecraft.server.command.CommandManager;
import net.minecraft.util.math.BlockPos;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.text.Text;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;

public final class PersistenceFixture {
    public static LiteralArgumentBuilder<ServerCommandSource> commands() {
        var root = CommandManager.literal("persistence").requires(source -> source.hasPermissionLevel(2) && Boolean.getBoolean("mch.fixture.persistence"));
        for (String action : java.util.List.of("seed", "block", "counter", "inventory", "saved")) {
            root.then(CommandManager.literal(action).then(CommandManager.argument("nonce", StringArgumentType.word()).executes(c -> run(c.getSource(), action, StringArgumentType.getString(c, "nonce")))));
        }
        return root;
    }
    private static int run(ServerCommandSource source, String action, String nonce) {
        var world = source.getWorld(); var pos = new BlockPos(8, 80, 8); world.getChunk(pos);
        if (action.equals("seed")) {
            world.setBlockState(pos, FixtureMod.COUNTER.getDefaultState().with(CounterBlock.PERSISTENT, true), 3);
            var counter = (CounterBlockEntity) world.getBlockEntity(pos);
            for (int i = 0; i < 37; i++) counter.increment();
            counter.store(new ItemStack(Items.DIAMOND, 13)); PersistenceData.get(world).seed(nonce);
        }
        var entity = world.getBlockEntity(pos);
        boolean passed = switch (action) {
            case "seed" -> PersistenceData.get(world).matches(nonce);
            case "block" -> world.getBlockState(pos).isOf(FixtureMod.COUNTER) && world.getBlockState(pos).get(CounterBlock.PERSISTENT);
            case "counter" -> entity instanceof CounterBlockEntity counter && counter.value() == 37;
            case "inventory" -> entity instanceof CounterBlockEntity counter && counter.stored().isOf(Items.DIAMOND) && counter.stored().getCount() == 13;
            case "saved" -> PersistenceData.get(world).matches(nonce);
            default -> false;
        };
        String message = "MCH_PERSISTENCE " + action + " " + nonce + " " + (passed ? "PASS" : "FAIL");
        source.sendFeedback(() -> Text.literal(message), false); return passed ? 1 : 0;
    }
}
