package dev.mch.fixture;

import net.fabricmc.fabric.api.gametest.v1.FabricGameTest;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.test.GameTest;
import net.minecraft.test.TestContext;
import net.minecraft.util.math.BlockPos;

public final class FixtureGameTests implements FabricGameTest {
    @GameTest(templateName = FabricGameTest.EMPTY_STRUCTURE)
    public void counter_initial(TestContext context) {
        var pos = new BlockPos(1, 1, 1);
        context.setBlockState(pos, FixtureMod.COUNTER.getDefaultState());
        var counter = (CounterBlockEntity) context.getBlockEntity(pos);
        context.assertTrue(counter.value() == 0, "new counter must be zero");
        context.assertTrue(counter.increment() == 1, "counter must increment on server");
        context.complete();
    }
    @GameTest(templateName = FabricGameTest.EMPTY_STRUCTURE)
    public void counter_persistence(TestContext context) {
        var pos = new BlockPos(1, 1, 1);
        context.setBlockState(pos, FixtureMod.COUNTER.getDefaultState());
        var counter = (CounterBlockEntity) context.getBlockEntity(pos);
        counter.increment(); counter.increment();
        var registries = context.getWorld().getRegistryManager();
        var saved = counter.createNbtWithId(registries);
        var restored = BlockEntity.createFromNbt(context.getAbsolutePos(pos), FixtureMod.COUNTER.getDefaultState(), saved, registries);
        context.assertTrue(restored instanceof CounterBlockEntity && ((CounterBlockEntity) restored).value() == 2, "NBT round trip must preserve counter");
        context.complete();
    }
}
