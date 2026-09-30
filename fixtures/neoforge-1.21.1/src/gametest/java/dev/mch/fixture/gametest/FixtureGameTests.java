package dev.mch.fixture.gametest;

import dev.mch.fixture.CounterBlockEntity;
import dev.mch.fixture.FixtureMod;

import net.minecraft.core.BlockPos;
import net.minecraft.gametest.framework.GameTest;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.neoforged.neoforge.gametest.GameTestHolder;
import net.neoforged.neoforge.gametest.PrefixGameTestTemplate;

@GameTestHolder("fixture")
@PrefixGameTestTemplate(false)
public final class FixtureGameTests {
    @GameTest(template = "empty", templateNamespace = "fixture")
    public static void counter_initial(GameTestHelper helper) {
        var pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, FixtureMod.COUNTER.get().defaultBlockState());
        var counter = (CounterBlockEntity) helper.getBlockEntity(pos);
        helper.assertTrue(counter.value() == 0, "new counter must be zero");
        helper.assertTrue(counter.increment() == 1, "counter must increment on server");
        helper.succeed();
    }
    @GameTest(template = "empty", templateNamespace = "fixture")
    public static void counter_persistence(GameTestHelper helper) {
        var pos = new BlockPos(1, 1, 1);
        helper.setBlock(pos, FixtureMod.COUNTER.get().defaultBlockState());
        var counter = (CounterBlockEntity) helper.getBlockEntity(pos);
        counter.increment(); counter.increment();
        var registries = helper.getLevel().registryAccess();
        var saved = counter.saveWithFullMetadata(registries);
        var restored = BlockEntity.loadStatic(helper.absolutePos(pos), FixtureMod.COUNTER.get().defaultBlockState(), saved, registries);
        helper.assertTrue(restored instanceof CounterBlockEntity && ((CounterBlockEntity) restored).value() == 2, "NBT round trip must preserve counter");
        helper.succeed();
    }
}
