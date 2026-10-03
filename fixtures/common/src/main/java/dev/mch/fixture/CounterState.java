package dev.mch.fixture;

/** Pure Java state bounded to the signed short range used by screen properties. */
public final class CounterState {
    public static final int MAXIMUM = 32767;
    private int value;
    public CounterState() { this(0); }
    public CounterState(int value) { this.value = Math.max(0, Math.min(value, MAXIMUM)); }
    public int value() { return value; }
    public int increment() { if (value < MAXIMUM) value++; return value; }
}
