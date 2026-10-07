package dev.mch.fixture;
import net.minecraft.world.PersistentState;
import net.minecraft.nbt.NbtCompound;
import net.minecraft.server.world.ServerWorld;

/** Custom world data deliberately separate from the counter block entity. */
public final class PersistenceData extends PersistentState {
    private String token = "";
    private int value;
    public static PersistenceData get(ServerWorld world) { return world.getPersistentStateManager().getOrCreate(PersistenceData::read, PersistenceData::new, "fixture_persistence"); }
    private static PersistenceData read(NbtCompound tag) {
        var data = new PersistenceData(); data.token = tag.getString("Token"); data.value = "saved".equals(System.getProperty("mch.fixture.breakPersistence")) ? 0 : tag.getInt("Value"); return data;
    }
    public void seed(String nonce) { token = nonce; value = 73; markDirty(); }
    public boolean matches(String nonce) { return token.equals(nonce) && value == 73; }
    @Override public NbtCompound writeNbt(NbtCompound tag) { tag.putString("Token", token); tag.putInt("Value", value); return tag; }
}
