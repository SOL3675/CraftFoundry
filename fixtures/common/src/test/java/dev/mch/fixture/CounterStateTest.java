package dev.mch.fixture;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
final class CounterStateTest {
    @Test void increment() { var counter = new CounterState(); assertEquals(1, counter.increment()); assertEquals(2, counter.increment()); }
    @Test void restoreAndBound() { assertEquals(12, new CounterState(12).value()); assertEquals(0, new CounterState(-4).value()); assertEquals(CounterState.MAXIMUM, new CounterState(Integer.MAX_VALUE).increment()); }
}
