package dev.mch.fixture;

import net.minecraft.block.BlockRenderType;
import net.minecraft.block.BlockState;
import net.minecraft.block.BlockWithEntity;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.world.World;

import net.minecraft.state.StateManager;
import net.minecraft.state.property.BooleanProperty;
import net.minecraft.block.Block;

public final class CounterBlock extends BlockWithEntity {
    public static final BooleanProperty PERSISTENT = BooleanProperty.of("persistent");
    public CounterBlock(Settings settings) { super(settings); setDefaultState(getStateManager().getDefaultState().with(PERSISTENT, false)); }
    @Override protected void appendProperties(StateManager.Builder<Block, BlockState> builder) { builder.add(PERSISTENT); }
    @Override public BlockRenderType getRenderType(BlockState state) { return BlockRenderType.MODEL; }
    @Override public BlockEntity createBlockEntity(BlockPos pos, BlockState state) { return new CounterBlockEntity(pos, state); }
    @Override public ActionResult onUse(BlockState state, World world, BlockPos pos, PlayerEntity player, Hand hand, BlockHitResult hit) {
        if (!world.isClient && world.getBlockEntity(pos) instanceof CounterBlockEntity counter) {
            counter.increment();
            player.openHandledScreen(counter);
        }
        return ActionResult.SUCCESS;
    }
}
