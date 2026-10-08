package dev.mch.fixture;

import net.minecraft.block.BlockState;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.network.packet.s2c.play.BlockEntityUpdateS2CPacket;
import net.minecraft.registry.RegistryWrapper;
import net.minecraft.screen.NamedScreenHandlerFactory;
import net.minecraft.screen.PropertyDelegate;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;

import net.minecraft.item.ItemStack;

public final class CounterBlockEntity extends BlockEntity implements NamedScreenHandlerFactory {
    private CounterState counter = new CounterState();
    private ItemStack stored = ItemStack.EMPTY;
    public ItemStack stored() { return stored; }
    public void store(ItemStack stack) { stored = stack.copy(); markDirty(); }
    public CounterBlockEntity(BlockPos pos, BlockState state) { super(FixtureMod.COUNTER_ENTITY, pos, state); }
    public int value() { return counter.value(); }
    public int increment() {
        int value = counter.increment();
        markDirty();
        if (!FixtureMod.BREAK_SYNC && world instanceof ServerWorld server) server.getChunkManager().markForUpdate(pos);
        return value;
    }
    @Override protected void readNbt(NbtCompound nbt, RegistryWrapper.WrapperLookup registries) {
        super.readNbt(nbt, registries);
        counter = new CounterState("counter".equals(System.getProperty("mch.fixture.breakPersistence")) ? 0 : nbt.getInt("Counter"));
        stored = "inventory".equals(System.getProperty("mch.fixture.breakPersistence")) ? ItemStack.EMPTY : ItemStack.fromNbtOrEmpty(registries, nbt.getCompound("Stored"));
    }
    @Override protected void writeNbt(NbtCompound nbt, RegistryWrapper.WrapperLookup registries) {
        super.writeNbt(nbt, registries);
        nbt.putInt("Counter", value());
        if (!stored.isEmpty()) nbt.put("Stored", stored.encode(registries));
    }
    @Override public NbtCompound toInitialChunkDataNbt(RegistryWrapper.WrapperLookup registries) {
        var snapshot = createNbt(registries);
        if (FixtureMod.BREAK_SYNC) snapshot.putInt("Counter", 0);
        return snapshot;
    }
    @Override public BlockEntityUpdateS2CPacket toUpdatePacket() {
        return FixtureMod.BREAK_SYNC ? null : BlockEntityUpdateS2CPacket.create(this);
    }
    @Override public Text getDisplayName() { return Text.translatable("block.fixture.counter"); }
    @Override public ScreenHandler createMenu(int syncId, PlayerInventory inventory, PlayerEntity player) {
        return new CounterScreenHandler(syncId, inventory, new PropertyDelegate() {
            @Override public int get(int index) { return FixtureMod.BREAK_SYNC ? 0 : value(); }
            @Override public void set(int index, int value) { /* Client cannot mutate server state through a property. */ }
            @Override public int size() { return 1; }
        }, pos);
    }
}
