package dev.mch.fixture;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.core.HolderLookup;

/** Custom world data deliberately separate from the counter block entity. */
public final class PersistenceData extends SavedData {
    private String token = "";
    private int value;
    private static final Factory<PersistenceData> TYPE = new Factory<>(PersistenceData::new, PersistenceData::read, null);
    public static PersistenceData get(ServerLevel world) { return world.getDataStorage().computeIfAbsent(TYPE, "fixture_persistence"); }
    private static PersistenceData read(CompoundTag tag, HolderLookup.Provider registries) {
        var data = new PersistenceData(); data.token = tag.getString("Token"); data.value = "saved".equals(System.getProperty("mch.fixture.breakPersistence")) ? 0 : tag.getInt("Value"); return data;
    }
    public void seed(String nonce) { token = nonce; value = 73; setDirty(); }
    public boolean matches(String nonce) { return token.equals(nonce) && value == 73; }
    @Override public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) { tag.putString("Token", token); tag.putInt("Value", value); return tag; }
}
