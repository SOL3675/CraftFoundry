package dev.mch.fixture.client;

import dev.mch.fixture.CounterScreenHandler;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.text.Text;

public final class CounterScreen extends HandledScreen<CounterScreenHandler> {
    public CounterScreen(CounterScreenHandler handler, PlayerInventory inventory, Text title) {
        super(handler, inventory, title);
        backgroundWidth = 176;
        backgroundHeight = 90;
    }
    @Override protected void drawBackground(DrawContext context, float delta, int mouseX, int mouseY) {
        context.fill(x, y, x + backgroundWidth, y + backgroundHeight, 0xFF202838);
        context.drawCenteredTextWithShadow(textRenderer, "Counter: " + handler.value(), x + backgroundWidth / 2, y + 40, 0xFFFFFF);
    }
    @Override protected void drawForeground(DrawContext context, int mouseX, int mouseY) {
        context.drawText(textRenderer, title, 8, 8, 0xFFFFFF, false);
    }
    @Override public void render(DrawContext context, int mouseX, int mouseY, float delta) {
        super.render(context, mouseX, mouseY, delta);
        drawMouseoverTooltip(context, mouseX, mouseY);
    }
}
