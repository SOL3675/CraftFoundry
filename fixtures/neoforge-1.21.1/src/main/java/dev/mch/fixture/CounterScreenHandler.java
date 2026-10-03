package dev.mch.fixture;

import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerData;
import net.minecraft.world.inventory.SimpleContainerData;
import net.minecraft.world.item.ItemStack;

public final class CounterScreenHandler extends AbstractContainerMenu {
    private final ContainerData properties;
    private final BlockPos pos;
    public CounterScreenHandler(int id, Inventory inventory) { this(id, inventory, new SimpleContainerData(1), null); }
    public CounterScreenHandler(int id, Inventory inventory, ContainerData properties, BlockPos pos) {
        super(FixtureMod.COUNTER_SCREEN.get(), id); this.properties = properties; this.pos = pos; addDataSlots(properties);
    }
    public int value() { return properties.get(0); }
    @Override public boolean stillValid(Player player) { return pos == null || player.level().getBlockState(pos).is(FixtureMod.COUNTER.get()) && player.distanceToSqr(pos.getX() + 0.5, pos.getY() + 0.5, pos.getZ() + 0.5) <= 64; }
    @Override public ItemStack quickMoveStack(Player player, int slot) { return ItemStack.EMPTY; }
}
