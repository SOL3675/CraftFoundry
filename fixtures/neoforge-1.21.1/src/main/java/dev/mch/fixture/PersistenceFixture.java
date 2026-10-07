package dev.mch.fixture;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.core.BlockPos;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.network.chat.Component;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;

public final class PersistenceFixture {
    public static LiteralArgumentBuilder<CommandSourceStack> commands() {
        var root = Commands.literal("persistence").requires(source -> source.hasPermission(2) && Boolean.getBoolean("mch.fixture.persistence"));
        for (String action : java.util.List.of("seed", "block", "counter", "inventory", "saved")) {
            root.then(Commands.literal(action).then(Commands.argument("nonce", StringArgumentType.word()).executes(c -> run(c.getSource(), action, StringArgumentType.getString(c, "nonce")))));
        }
        return root;
    }
    private static int run(CommandSourceStack source, String action, String nonce) {
        var world = source.getLevel(); var pos = new BlockPos(8, 80, 8); world.getChunk(pos);
        if (action.equals("seed")) {
            world.setBlock(pos, FixtureMod.COUNTER.get().defaultBlockState().setValue(CounterBlock.PERSISTENT, true), 3);
            var counter = (CounterBlockEntity) world.getBlockEntity(pos);
            for (int i = 0; i < 37; i++) counter.increment();
            counter.store(new ItemStack(Items.DIAMOND, 13)); PersistenceData.get(world).seed(nonce);
        }
        var entity = world.getBlockEntity(pos);
        boolean passed = switch (action) {
            case "seed" -> PersistenceData.get(world).matches(nonce);
            case "block" -> world.getBlockState(pos).is(FixtureMod.COUNTER.get()) && world.getBlockState(pos).getValue(CounterBlock.PERSISTENT);
            case "counter" -> entity instanceof CounterBlockEntity counter && counter.value() == 37;
            case "inventory" -> entity instanceof CounterBlockEntity counter && counter.stored().is(Items.DIAMOND) && counter.stored().getCount() == 13;
            case "saved" -> PersistenceData.get(world).matches(nonce);
            default -> false;
        };
        String message = "MCH_PERSISTENCE " + action + " " + nonce + " " + (passed ? "PASS" : "FAIL");
        source.sendSuccess(() -> Component.literal(message), false); return passed ? 1 : 0;
    }
}
