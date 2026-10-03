package dev.mch.fixture.client;

import dev.mch.fixture.CounterScreenHandler;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Inventory;

public final class CounterScreen extends AbstractContainerScreen<CounterScreenHandler> {
    public CounterScreen(CounterScreenHandler menu, Inventory inventory, Component title) { super(menu, inventory, title); imageWidth = 176; imageHeight = 90; }
    @Override protected void renderBg(GuiGraphics graphics, float delta, int mouseX, int mouseY) {
        graphics.fill(leftPos, topPos, leftPos + imageWidth, topPos + imageHeight, 0xFF202838);
        graphics.drawCenteredString(font, "Counter: " + menu.value(), leftPos + imageWidth / 2, topPos + 40, 0xFFFFFF);
    }
    @Override protected void renderLabels(GuiGraphics graphics, int mouseX, int mouseY) { graphics.drawString(font, title, 8, 8, 0xFFFFFF, false); }
    @Override public void render(GuiGraphics graphics, int mouseX, int mouseY, float delta) { super.render(graphics, mouseX, mouseY, delta); renderTooltip(graphics, mouseX, mouseY); }
}
