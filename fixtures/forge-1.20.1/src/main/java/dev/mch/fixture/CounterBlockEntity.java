package dev.mch.fixture;

import net.minecraft.core.BlockPos;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.protocol.game.ClientboundBlockEntityDataPacket;
import net.minecraft.world.MenuProvider;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.ContainerData;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;

public final class CounterBlockEntity extends BlockEntity implements MenuProvider {
    private CounterState counter = new CounterState();
    public CounterBlockEntity(BlockPos pos, BlockState state) { super(FixtureMod.COUNTER_ENTITY.get(), pos, state); }
    public int value() { return counter.value(); }
    public int increment() {
        int value = counter.increment(); setChanged();
        if (!FixtureMod.BREAK_SYNC && level != null && !level.isClientSide) level.sendBlockUpdated(worldPosition, getBlockState(), getBlockState(), 2);
        return value;
    }
    @Override public void load(CompoundTag tag) { super.load(tag); counter = new CounterState(tag.getInt("Counter")); }
    @Override protected void saveAdditional(CompoundTag tag) { super.saveAdditional(tag); tag.putInt("Counter", value()); }
    @Override public CompoundTag getUpdateTag() {
        var tag = saveWithoutMetadata(); if (FixtureMod.BREAK_SYNC) tag.putInt("Counter", 0); return tag;
    }
    @Override public ClientboundBlockEntityDataPacket getUpdatePacket() { return FixtureMod.BREAK_SYNC ? null : ClientboundBlockEntityDataPacket.create(this); }
    @Override public Component getDisplayName() { return Component.translatable("block.fixture.counter"); }
    @Override public AbstractContainerMenu createMenu(int id, Inventory inventory, Player player) {
        return new CounterScreenHandler(id, inventory, new ContainerData() {
            @Override public int get(int index) { return FixtureMod.BREAK_SYNC ? 0 : value(); }
            @Override public void set(int index, int value) { }
            @Override public int getCount() { return 1; }
        }, worldPosition);
    }
}

