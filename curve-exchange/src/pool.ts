import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";

import {
  AddLiquidity as AddLiquidity2Coins,
  AddLiquidity1 as AddLiquidity3Coins,
  AddLiquidity2 as AddLiquidity4Coins,
  RemoveLiquidity as RemoveLiquidity2Coins,
  RemoveLiquidity as RemoveLiquidity3Coins,
  RemoveLiquidity as RemoveLiquidity4Coins,
  RemoveLiquidityImbalance as RemoveLiquidityImbalance2Coins,
  RemoveLiquidityImbalance as RemoveLiquidityImbalance3Coins,
  RemoveLiquidityImbalance as RemoveLiquidityImbalance4Coins,
  RemoveLiquidityOne as RemoveLiquidityOne_v1,
  RemoveLiquidityOne1 as RemoveLiquidityOne_v2,
  Remove_liquidity_one_coinCall,
  TokenExchange,
} from "../generated/templates/CurvePool/CurvePool";

// import {
//   AddLiquidity as AddLiquidityTriCrypto,
//   RemoveLiquidity as RemoveLiquidityTriCrypto,
//   Remove_liquidity_one_coinCall as Remove_liquidity_one_coin_tricrypto_Call,
//   TokenExchange as TokenExchangeTriCrypto,
// } from "../generated/TRICRYPTOPool/StableSwapTriCrypto";
import { ERC20, Transfer } from "../generated/templates/PoolLPToken/ERC20";
import {
  LPTokenTransferToZero as LPTokenTransferToZeroEntity,
  Market as MarketEntity,
  Pool as PoolEntity,
  RemoveLiqudityOneEvent as RemoveLiqudityOneEventEntity,
} from "../generated/schema";
import { PoolLPToken } from "../generated/templates";
import {
  ADDRESS_ZERO,
  getOrCreateAccount,
  investInMarket,
  redeemFromMarket,
  TokenBalance,
} from "./common";
import {
  getOrCreatePool,
  getOtCreateAccountLiquidity as getOrCreateAccountLiquidity,
  updatePool,
  getPoolFromLpToken,
  getLpTokenOfPool,
  getOrCreateRemoveLiquidityOneEvent,
} from "./curveUtil";

export function handleAddLiquidity2Coins(event: AddLiquidity2Coins): void {
  handleAddLiquidityCommon(
    event,
    event.address,
    event.params.token_supply,
    event.params.token_amounts,
    event.params.provider
  );
}

export function handleAddLiquidity3Coins(event: AddLiquidity3Coins): void {
  handleAddLiquidityCommon(
    event,
    event.address,
    event.params.token_supply,
    event.params.token_amounts,
    event.params.provider
  );
}

export function handleAddLiquidity4Coins(event: AddLiquidity4Coins): void {
  handleAddLiquidityCommon(
    event,
    event.address,
    event.params.token_supply,
    event.params.token_amounts,
    event.params.provider
  );
}

// export function handleAddLiquidityTriCrypto(event: AddLiquidityTriCrypto): void {
//   handleAddLiquidityCommon(
//     event,
//     event.address,
//     event.params.token_supply,
//     event.params.token_amounts,
//     event.params.provider
//   );
// }

/**
 * Function receives unpacked event params (in order to support different
 * event signatures) and handles the AddLiquidity event.
 * @param event
 * @param poolAddress
 * @param newTotalSupply
 * @param inputTokenAmountProvided
 * @param provider
 */
function handleAddLiquidityCommon(
  event: ethereum.Event,
  poolAddress: Address,
  newTotalSupply: BigInt,
  inputTokenAmountProvided: BigInt[],
  provider: Address
): void {
  // create pool
  let pool = getOrCreatePool(event, poolAddress);

  // create LPToken entity from template when pool is createed
  // if (pool.totalSupply == BigInt.fromI32(0)) {
  //   PoolLPToken.create(pool.lpToken as Address);
  // }

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // Update pool entity balances and totalSupply of LP tokens
  let oldTotalSupply = pool.totalSupply;

  let market = MarketEntity.load(pool.id) as MarketEntity;

  // add tokens provided to market's input token balance
  let inputTokens = market.inputTokens as string[];
  let inputTokenTotalBalances = market.inputTokenTotalBalances as string[];§
  let newInputTokenBalances: BigInt[] = [];
  for (let i = 0; i < pool.coinCount; i++) {
    let oldBalance = TokenBalance.fromString(inputTokenTotalBalances[i]).balance;
    let newBalance = oldBalance.plus(inputTokenAmountProvided[i]);
    newInputTokenBalances.push(newBalance);
  }
  // let newPoolBalances = getPoolBalances(pool);
  // let newPoolBalances = pool.balances;

  // If token supply in event is 0, then check directly from contract
  // let currentTokenSupply = newTotalSupply;
  // if (currentTokenSupply == BigInt.fromI32(0)) {
  //   let contract = ERC20.bind(getLpTokenOfPool(Address.fromString(pool.id)));
  //   let supply = contract.try_totalSupply();
  //   if (!supply.reverted) {
  //     currentTokenSupply = supply.value;
  //   }
  // }

  pool = updatePool(event, pool, newInputTokenBalances, newTotalSupply);

  // Update AccountLiquidity to track LPToken balance of account
  let account = getOrCreateAccount(provider);
  let lpTokensMinted = newTotalSupply.minus(oldTotalSupply);

  let accountLiquidity = getOrCreateAccountLiquidity(account, pool);
  accountLiquidity.balance = accountLiquidity.balance.plus(lpTokensMinted);
  accountLiquidity.save();

  // Collect data for position update
  let lpTokensBalance = accountLiquidity.balance;
  let providedTokenAmounts = inputTokenAmountProvided;
  let inputTokensProvided: TokenBalance[] = [];
  let inputTokensBalance: TokenBalance[] = [];
  let coins = pool.coins;
  for (let i = 0; i < pool.coinCount; i++) {
    inputTokensProvided.push(new TokenBalance(coins[i], account.id, providedTokenAmounts[i]));

    // number of pool input tokens that can be redeemed by account's LP tokens
    let inputBalance = newInputTokenBalances[i].times(lpTokensBalance).div(pool.totalSupply);
    inputTokensBalance.push(new TokenBalance(coins[i], account.id, inputBalance));
  }

  // use common function to update position and store transaction
  investInMarket(
    event,
    account,
    market,
    lpTokensMinted,
    inputTokensProvided,
    [],
    lpTokensBalance,
    inputTokensBalance,
    [],
    null
  );
}

export function handleRemoveLiquidity2Coins(event: RemoveLiquidity2Coins): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update all relevant entities
  handleRemoveLiquidityCommon(
    event,
    pool,
    event.params.provider,
    event.params.token_amounts,
    event.params.token_supply
  );
}

export function handleRemoveLiquidity3Coins(event: RemoveLiquidity3Coins): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update all relevant entities
  handleRemoveLiquidityCommon(
    event,
    pool,
    event.params.provider,
    event.params.token_amounts,
    event.params.token_supply
  );
}

export function handleRemoveLiquidity4Coins(event: RemoveLiquidity4Coins): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update all relevant entities
  handleRemoveLiquidityCommon(
    event,
    pool,
    event.params.provider,
    event.params.token_amounts,
    event.params.token_supply
  );
}

// export function handleRemoveLiquidityTriCrypto(event: RemoveLiquidityTriCrypto): void {
//   // create pool
//   let pool = getOrCreatePool(event, event.address);

//   // handle any pending LP token tranfers to zero address
//   checkPendingTransferToZero(event, pool);

//   // update all relevant entities
//   handleRemoveLiquidityCommon(
//     event,
//     pool,
//     event.params.provider,
//     event.params.token_amounts,
//     event.params.token_supply
//   );
// }

/**
 * Common function for entity update after liquidity removal
 * @param event
 * @param pool
 * @param provider
 * @param tokenAmounts
 * @param lpTokenSupply
 */
function handleRemoveLiquidityCommon(
  event: ethereum.Event,
  pool: PoolEntity,
  provider: Address,
  tokenAmounts: BigInt[],
  lpTokenSupply: BigInt
): void {
  // Update balances and totalSupply
  let oldTotalSupply = pool.totalSupply;
  // let newBalances = getPoolBalances(pool); TODO
  let newBalances = pool.balances;

  pool = updatePool(event, pool, newBalances, lpTokenSupply);
  pool.lastTransferToZero = null;
  pool.save();

  // Update AccountLiquidity to track LPToken balance of account
  let account = getOrCreateAccount(provider);
  let lpTokenAmount = oldTotalSupply.minus(lpTokenSupply);

  let accountLiquidity = getOrCreateAccountLiquidity(account, pool);
  accountLiquidity.balance = accountLiquidity.balance.minus(lpTokenAmount);
  accountLiquidity.save();

  // Collect data for position update
  let market = MarketEntity.load(pool.id) as MarketEntity;
  let accountLpTokenBalance = accountLiquidity.balance;
  let inputTokenAmounts: TokenBalance[] = [];
  let inputTokenBalances: TokenBalance[] = [];
  let coins = pool.coins;
  for (let i = 0; i < pool.coinCount; i++) {
    let token = coins[i];
    let inputAmount = tokenAmounts[i];
    let inputBalance: BigInt;
    //in case there is no liquidity
    if (pool.totalSupply == BigInt.fromI32(0)) {
      inputBalance = BigInt.fromI32(0);
    } else {
      inputBalance = newBalances[i].times(accountLiquidity.balance).div(pool.totalSupply);
    }
    inputTokenAmounts.push(new TokenBalance(token, account.id, inputAmount));
    inputTokenBalances.push(new TokenBalance(token, account.id, inputBalance));
  }

  // use common function to update position and store transaction
  redeemFromMarket(
    event,
    account,
    market,
    lpTokenAmount,
    inputTokenAmounts,
    [],
    accountLpTokenBalance,
    inputTokenBalances,
    [],
    null
  );
}

export function handleRemoveLiquidityImbalance2Coins(event: RemoveLiquidityImbalance2Coins): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update all relevant entities
  handleRemoveLiquidityCommon(
    event,
    pool,
    event.params.provider,
    event.params.token_amounts,
    event.params.token_supply
  );
}

export function handleRemoveLiquidityImbalance3Coins(event: RemoveLiquidityImbalance3Coins): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update all relevant entities
  handleRemoveLiquidityCommon(
    event,
    pool,
    event.params.provider,
    event.params.token_amounts,
    event.params.token_supply
  );
}

export function handleRemoveLiquidityImbalance4Coins(event: RemoveLiquidityImbalance4Coins): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update all relevant entities
  handleRemoveLiquidityCommon(
    event,
    pool,
    event.params.provider,
    event.params.token_amounts,
    event.params.token_supply
  );
}

export function handleTokenExchange(event: TokenExchange): void {
  handleTokenExchangeCommon(event, event.address);
}

// export function handleTokenExchangeTriCrypto(event: TokenExchangeTriCrypto): void {
//   handleTokenExchangeCommon(event, event.address);
// }

/**
 * Function receives unpacked event params (in order to support different
 * event signatures) and handles the TokenExchange event.
 * @param event
 * @param address
 */
function handleTokenExchangeCommon(event: ethereum.Event, address: Address): void {
  // create pool
  let pool = getOrCreatePool(event, address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // update pool entity with new token balances
  // let newPoolBalances = getPoolBalances(pool);
  let newPoolBalances = pool.balances;
  updatePool(event, pool, newPoolBalances, pool.totalSupply);
}

export function handleTransfer(event: Transfer): void {
  // don't handle zero-value tranfers or transfers from zero-address
  if (event.params.value == BigInt.fromI32(0) || event.params.from.toHexString() == ADDRESS_ZERO) {
    return;
  }

  let pool = getOrCreatePool(event, getPoolFromLpToken(event.address));

  // if receiver is zero-address create tranferToZero entity and return - position updates are done in add/remove liquidity handlers
  if (event.params.to.toHexString() == ADDRESS_ZERO) {
    let transferToZero = new LPTokenTransferToZeroEntity(event.transaction.hash.toHexString());
    transferToZero.from = event.params.from;
    transferToZero.to = event.params.to;
    transferToZero.value = event.params.value;
    transferToZero.save();

    pool.lastTransferToZero = transferToZero.id;
    pool.save();

    return;
  }

  // update all relevant entities
  transferLPToken(event, pool, event.params.from, event.params.to, event.params.value);
}

export function handleRemoveLiquidityOne_v1(event: RemoveLiquidityOne_v1): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // create RemoveLiquidityOne entity
  let id = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(pool.id);
  let entity = getOrCreateRemoveLiquidityOneEvent(id, pool);
  entity.eventApplied = true;
  entity.account = getOrCreateAccount(event.params.provider).id;
  entity.tokenAmount = event.params.token_amount;
  entity.dy = event.params.coin_amount;
  entity.logIndex = event.logIndex;
  entity.save();

  handleRLOEEntityUpdate(event, entity, pool);
}

export function handleRemoveLiquidityOne_v2(event: RemoveLiquidityOne_v2): void {
  // create pool
  let pool = getOrCreatePool(event, event.address);

  // handle any pending LP token tranfers to zero address
  checkPendingTransferToZero(event, pool);

  // create RemoveLiquidityOne entity
  let id = event.transaction.hash
    .toHexString()
    .concat("-")
    .concat(pool.id);
  let entity = getOrCreateRemoveLiquidityOneEvent(id, pool);
  entity.eventApplied = true;
  entity.account = getOrCreateAccount(event.params.provider).id;
  entity.tokenAmount = event.params.token_amount;
  entity.dy = event.params.coin_amount;
  entity.logIndex = event.logIndex;
  entity.save();

  handleRLOEEntityUpdate(event, entity, pool);
}

export function handleRemoveLiquidityOneCall(call: Remove_liquidity_one_coinCall): void {
  handleRemoveLiquidityOneCallCommon(call, call.inputs.i);
}

// export function handleRemoveLiquidityOneTriCryptoCall(
//   call: Remove_liquidity_one_coin_tricrypto_Call
// ): void {
//   handleRemoveLiquidityOneCallCommon(call, call.inputs.i);
// }

/**
 * Function receives unpacked call params (in order to support different
 * event signatures) and handles the RemoveLiquidityOneCall event.
 * @param call
 * @param i
 */
function handleRemoveLiquidityOneCallCommon(call: ethereum.Call, i: BigInt): void {
  // load pool
  let pool = PoolEntity.load(call.to.toHexString()) as PoolEntity;

  // update RemoveLiquidityOne entity
  let id = call.transaction.hash
    .toHexString()
    .concat("-")
    .concat(pool.id);
  let entity = getOrCreateRemoveLiquidityOneEvent(id, pool);
  entity.i = i.toI32();
  entity.callApplied = true;
  entity.save();

  let event = new ethereum.Event();
  event.block = call.block;
  event.transaction = call.transaction;
  event.logIndex = entity.logIndex as BigInt;
  handleRLOEEntityUpdate(event, entity, pool);
}

/**
 * Update sender's and receiver's positions when LP token is transferred
 * @param event
 * @param pool
 * @param from
 * @param to
 * @param value
 */
function transferLPToken(
  event: ethereum.Event,
  pool: PoolEntity,
  from: Address,
  to: Address,
  value: BigInt
): void {
  // Substract transferred LP tokens from sender's account
  let fromAccount = getOrCreateAccount(from);
  let fromLpTokensTransferred = value;

  let fromAccountLiquidity = getOrCreateAccountLiquidity(fromAccount, pool);
  fromAccountLiquidity.balance = fromAccountLiquidity.balance.minus(fromLpTokensTransferred);
  fromAccountLiquidity.save();

  // Collect data for position update
  let market = MarketEntity.load(pool.id) as MarketEntity;
  let fromLpTokenBalance = fromAccountLiquidity.balance;
  let fromInputTokenBalances: TokenBalance[] = [];
  let coins = pool.coins;
  let balances = pool.balances;
  for (let i = 0; i < pool.coinCount; i++) {
    // number of pool input tokens that can be redeemed by account's LP tokens
    let inputBalance = balances[i].times(fromAccountLiquidity.balance).div(pool.totalSupply);
    fromInputTokenBalances.push(new TokenBalance(coins[i], fromAccount.id, inputBalance));
  }

  // use common function to update position and store transaction
  redeemFromMarket(
    event,
    fromAccount,
    market,
    fromLpTokensTransferred,
    [],
    [],
    fromLpTokenBalance,
    fromInputTokenBalances,
    [],
    to.toHexString()
  );

  // Add transferred LP tokens to receiver's account
  let toAccount = getOrCreateAccount(to);
  let toLpTokensReceived = value;

  let toAccountLiquidity = getOrCreateAccountLiquidity(toAccount, pool);
  toAccountLiquidity.balance = toAccountLiquidity.balance.plus(toLpTokensReceived);
  toAccountLiquidity.save();

  // Collect data for position update
  let toOutputTokenBalance = toAccountLiquidity.balance;
  let toInputTokenBalances: TokenBalance[] = [];
  for (let i = 0; i < pool.coinCount; i++) {
    // number of pool input tokens that can be redeemed by account's LP tokens
    let inputBalance = balances[i].times(toAccountLiquidity.balance).div(pool.totalSupply);
    toInputTokenBalances.push(new TokenBalance(coins[i], toAccount.id, inputBalance));
  }

  // use common function to update position and store transaction
  investInMarket(
    event,
    toAccount,
    market,
    toLpTokensReceived,
    [],
    [],
    toOutputTokenBalance,
    toInputTokenBalances,
    [],
    from.toHexString()
  );
}

/**
 * Check if there is a pending transfer of LP tokens to zero address.
 * If yes, and it is not part of add/remove liquidity events, then update sender's position
 * Otherwise positions will be updated in add/remove liquidity handlers
 * @param event
 * @param pool
 * @returns
 */
function checkPendingTransferToZero(event: ethereum.Event, pool: PoolEntity): void {
  // This no ongoing LP token transfer to zero address
  if (pool.lastTransferToZero == null) {
    return;
  }

  // This LP token transfer to zero address is part of add/remove liquidity event, don't handle it here
  if (pool.lastTransferToZero == event.transaction.hash.toHexString()) {
    return;
  }

  // It's a manual transfer to zero address, not part of add/remove liquidity events
  // Update sender's position accordingly
  let transferTozero = LPTokenTransferToZeroEntity.load(
    pool.lastTransferToZero
  ) as LPTokenTransferToZeroEntity;
  transferLPToken(
    event,
    pool,
    transferTozero.from as Address,
    transferTozero.to as Address,
    transferTozero.value
  );

  pool.lastTransferToZero = null;
  pool.save();
}

/**
 * Collect data about one coin liquidity removal
 * @param event
 * @param entity
 * @param pool
 * @returns
 */
function handleRLOEEntityUpdate(
  event: ethereum.Event,
  entity: RemoveLiqudityOneEventEntity,
  pool: PoolEntity
): void {
  // handle liquidity removal only after both event and call are handled
  if (!entity.eventApplied || !entity.callApplied) {
    return;
  }

  // collect data from RemoveLiqudityOneEvent entity
  let tokenAmount = entity.tokenAmount as BigInt;
  let i = entity.i as i32;
  let dy = entity.dy as BigInt;
  let provider = Address.fromString(entity.account);

  let tokenAmounts: BigInt[] = [];
  for (let j = 0; j < pool.coinCount; j++) {
    if (j == i) {
      tokenAmounts[j] = dy;
    } else {
      tokenAmounts[j] = BigInt.fromI32(0);
    }
  }

  let totalSupply = pool.totalSupply.minus(tokenAmount);

  // use common function to update entities
  handleRemoveLiquidityCommon(event, pool, provider, tokenAmounts, totalSupply);
}
