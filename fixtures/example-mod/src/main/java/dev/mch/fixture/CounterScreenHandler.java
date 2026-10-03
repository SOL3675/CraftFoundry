package dev.mch.fixture;

import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.ArrayPropertyDelegate;
import net.minecraft.screen.PropertyDelegate;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.util.math.BlockPos;

public final class CounterScreenHandler extends ScreenHandler {
    private final PropertyDelegate properties;
    private final BlockPos pos;
    public CounterScreenHandler(int syncId, PlayerInventory inventory) { this(syncId, inventory, new ArrayPropertyDelegate(1), null); }
    public CounterScreenHandler(int syncId, PlayerInventory inventory, PropertyDelegate properties, BlockPos pos) {
        super(FixtureMod.COUNTER_SCREEN, syncId);
        this.properties = properties;
        this.pos = pos;
        addProperties(properties);
    }
    public int value() { return properties.get(0); }
    @Override public boolean canUse(PlayerEntity player) {
        return pos == null || (player.getWorld().getBlockState(pos).isOf(FixtureMod.COUNTER) && player.squaredDistanceTo(pos.toCenterPos()) <= 64);
    }
    @Override public ItemStack quickMove(PlayerEntity player, int slot) { return ItemStack.EMPTY; }
}
