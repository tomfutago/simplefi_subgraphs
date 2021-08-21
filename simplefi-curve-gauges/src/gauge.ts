import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";

import {
  Deposit,
  UpdateLiquidityLimit,
  Withdraw,
} from "../generated/templates/LiquidityGauge/LiquidityGauge";

import { Transfer } from "../generated/templates/ERC20Token/ERC20";
import { Minted } from "../generated/Minter/Minter";

import { LiquidityGauge as GaugeContract } from "../generated/GaugeController/LiquidityGauge";

import {
  GaugeDeposit,
  GaugeSnapshot,
  GaugeWithdraw,
  Gauge,
  Market,
  AccountLiquidity,
  Account,
  GaugeTokenTransferToZero,
} from "../generated/schema";

import {
  ADDRESS_ZERO,
  getOrCreateAccount,
  updateMarket,
  investInMarket,
  redeemFromMarket,
  TokenBalance,
} from "./common";

import { GaugeVersion } from "./constants";

export function handleDeposit(event: Deposit): void {
  let account = getOrCreateAccount(event.params.provider);

  // save new deposit entity
  let deposit = new GaugeDeposit(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  deposit.gauge = event.address.toHexString();
  deposit.provider = account.id;
  deposit.value = event.params.value.toBigDecimal();
  deposit.save();

  // get gauge
  let gauge = Gauge.load(event.address.toHexString());
  let gaugeContract = GaugeContract.bind(Address.fromString(gauge.id));

  //// Collect data for position update

  // market (representing gauge)
  let market = Market.load(gauge.id) as Market;

  // number of LP tokens deposited (equals to number of gauge tokens assigned to user)
  let outputTokenAmount = event.params.value;

  // number of LP tokens deposited by user
  let inputTokenAmounts = [new TokenBalance(gauge.lpToken, account.id, outputTokenAmount)];

  // number of reward tokens claimed by user in this transaction
  // TODO find a way to collect info
  let rewardTokenAmounts: TokenBalance[] = [];

  // total number of gauge tokens owned by user
  let accountLiquidity = getOrCreateAccountLiquidity(account, gauge);
  accountLiquidity.balance = accountLiquidity.balance.plus(event.params.value);
  accountLiquidity.save();
  let accountGaugeTokenBalance = accountLiquidity.balance;

  // inputTokenBalance -> number of LP tokens that can be redeemed by accounts's gauge tokens
  // in this case it is working balance of user (takes into account CRV vote boosting)
  let inputTokenBalances: TokenBalance[] = [];
  let inputBalance = gaugeContract.try_working_balances(Address.fromString(account.id));
  if (!inputBalance.reverted) {
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, inputBalance.value));
  } else {
    // in case working balance can't be fetched, assume inputTokenBalance is equal to gauge token balance (no boost)
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, accountGaugeTokenBalance));
  }

  // reward token amounts (CRV + custom tokens) claimable by user
  let rewardTokenBalances: TokenBalance[] = [];
  collectRewardTokenBalances(gauge, account, rewardTokenBalances, market);

  // use common function to update position and store transaction
  investInMarket(
    event,
    account,
    market,
    outputTokenAmount,
    inputTokenAmounts,
    rewardTokenAmounts,
    accountGaugeTokenBalance,
    inputTokenBalances,
    rewardTokenBalances,
    null
  );
}

export function handleWithdraw(event: Withdraw): void {
  let account = getOrCreateAccount(event.params.provider);

  // save new deposit entity
  let withdrawal = new GaugeWithdraw(
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString()
  );
  withdrawal.gauge = event.address.toHexString();
  withdrawal.provider = account.id;
  withdrawal.value = event.params.value.toBigDecimal();
  withdrawal.save();

  //////////////////////////////////////

  // get gauge
  let gauge = Gauge.load(event.address.toHexString());
  let gaugeContract = GaugeContract.bind(Address.fromString(gauge.id));

  //// Collect data for position update

  // market (representing gauge)
  let market = Market.load(gauge.id) as Market;

  // number of gauge tokens burned by user
  let outputTokenAmount = event.params.value;

  // number of LP tokens withdrawn by user
  let inputTokenAmounts = [new TokenBalance(gauge.lpToken, account.id, event.params.value)];

  // number of reward tokens claimed by user in this transaction
  // TODO find a way to collect info
  let rewardTokenAmounts: TokenBalance[] = [];

  // total number of gauge tokens owned by user
  let accountLiquidity = getOrCreateAccountLiquidity(account, gauge);
  accountLiquidity.balance = accountLiquidity.balance.minus(outputTokenAmount);
  accountLiquidity.save();
  let accountGaugeTokenBalance = accountLiquidity.balance;

  // inputTokenBalance -> number of LP tokens that can be redeemed by accounts's gauge tokens
  // in this case it is working balance of user (takes into account CRV vote boosting)
  let inputTokenBalances: TokenBalance[] = [];
  let inputBalance = gaugeContract.try_working_balances(Address.fromString(account.id));
  if (!inputBalance.reverted) {
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, inputBalance.value));
  } else {
    // in case working balance can't be fetched, assume inputTokenBalance is equal to gauge token balance (no boost)
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, accountGaugeTokenBalance));
  }

  // reward token amounts (CRV + custom tokens) claimable by user
  let rewardTokenBalances: TokenBalance[] = [];
  collectRewardTokenBalances(gauge, account, rewardTokenBalances, market);

  // use common function to update position and store transaction
  redeemFromMarket(
    event,
    account,
    market,
    outputTokenAmount,
    inputTokenAmounts,
    rewardTokenAmounts,
    accountGaugeTokenBalance,
    inputTokenBalances,
    rewardTokenBalances,
    null
  );
}

export function handleUpdateLiquidityLimit(event: UpdateLiquidityLimit): void {
  let transactionHash = event.transaction.hash.toHexString();
  let snapshotId = transactionHash.concat("-").concat(event.logIndex.toHexString());
  let gauge = Gauge.load(event.address.toHexString());

  // handle any pending gauge token tranfers to zero address
  checkPendingTransferToZero(event, gauge);

  // create gauge snapshot
  let gaugeSnapshot = new GaugeSnapshot(snapshotId);
  gaugeSnapshot.gauge = event.address.toHexString();
  gaugeSnapshot.originalSupply = gauge.totalSupply;
  gaugeSnapshot.workingSupply = gauge.workingSupply;
  gaugeSnapshot.timestamp = event.block.timestamp;
  gaugeSnapshot.transactionHash = transactionHash;
  gaugeSnapshot.transactionIndexInBlock = event.transaction.index;
  gaugeSnapshot.blockNumber = event.block.number;
  gaugeSnapshot.logIndex = event.logIndex;
  gaugeSnapshot.save();

  // if this was burn event, reset lastTransferToZero
  if (gauge.totalSupply > event.params.original_supply) {
    gauge.lastTransferToZero = null;
  }

  // update gauge's LP token total and working supply
  gauge.totalSupply = event.params.original_supply;
  gauge.workingSupply = event.params.working_supply;
  gauge.save();

  // update market and create market snapshot
  let market = Market.load(gauge.id) as Market;
  updateMarket(
    event,
    market,
    [new TokenBalance(gauge.lpToken, gauge.id, gauge.totalSupply)],
    gauge.totalSupply
  );
}

export function handleTransfer(event: Transfer): void {
  // if gauge contract generated event then it is gauge token transfer
  let gauge = Gauge.load(event.address.toHexString());
  if (gauge != null) {
    handleGaugeTokenTransfer(gauge, event);
    return;
  }

  // if gauge contract is sender ('from') then it is reward claim
  gauge = Gauge.load(event.params.from.toHexString());
  if (gauge != null) {
    handleRewardTokenClaim(gauge, event);
    return;
  }
}

export function handleMinted(event: Minted) {
  // get gauge
  let gauge = Gauge.load(event.params.gauge.toHexString());
  let gaugeContract = GaugeContract.bind(Address.fromString(gauge.id));

  //// Collect data for position update after CRV rewards have been transferred to user

  // user who gets minted CRV tokens
  let account = getOrCreateAccount(event.params.recipient);

  // market (representing gauge)
  let market = Market.load(gauge.id) as Market;

  // number of gauge tokens burned by user
  let outputTokenAmount = BigInt.fromI32(0);

  // number of LP tokens withdrawn by user
  let inputTokenAmounts = [];

  // number of reward tokens claimed by user in this transaction
  // this events tracks aquiring CRV tokens specifically
  let rewardTokenAmounts: TokenBalance[] = [];
  let crvTokenBalance = new TokenBalance(market.rewardTokens[0], account.id, event.params.minted);
  rewardTokenAmounts.push(crvTokenBalance);

  // total number of gauge tokens owned by user - no change in this case
  let accountLiquidity = getOrCreateAccountLiquidity(account, gauge);
  let accountGaugeTokenBalance = accountLiquidity.balance;

  // inputTokenBalance -> number of LP tokens that can be redeemed by accounts's gauge tokens
  // in this case it is working balance of user (takes into account CRV vote boosting)
  let inputTokenBalances: TokenBalance[] = [];
  let inputBalance = gaugeContract.try_working_balances(Address.fromString(account.id));
  if (!inputBalance.reverted) {
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, inputBalance.value));
  } else {
    // in case working balance can't be fetched, assume inputTokenBalance is equal to gauge token balance (no boost)
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, accountGaugeTokenBalance));
  }

  // update reward token amounts (CRV + custom tokens) claimable by user
  let rewardTokenBalances: TokenBalance[] = [];
  collectRewardTokenBalances(gauge, account, rewardTokenBalances, market);

  // use common function to update position and store transaction
  redeemFromMarket(
    event,
    account,
    market,
    outputTokenAmount,
    inputTokenAmounts,
    rewardTokenAmounts,
    accountGaugeTokenBalance,
    inputTokenBalances,
    rewardTokenBalances,
    null
  );
}

/**
 * AccountLiquidity tracks user's balance of gauge tokens
 * @param account
 * @param gauge
 * @returns
 */
function getOrCreateAccountLiquidity(account: Account, gauge: Gauge): AccountLiquidity {
  let id = account.id.concat("-").concat(gauge.id);
  let liquidity = AccountLiquidity.load(id);

  if (liquidity != null) {
    return liquidity as AccountLiquidity;
  }
  liquidity = new AccountLiquidity(id);
  liquidity.gauge = gauge.id;
  liquidity.account = account.id;
  liquidity.balance = BigInt.fromI32(0);
  liquidity.save();
  return liquidity as AccountLiquidity;
}

/**
 * Collect info from gauge contract about number of claimable reward tokens
 * using correct API calls (depends on gauge type)
 * @param gauge
 * @param account
 * @param rewardTokenBalances
 * @param market
 */
function collectRewardTokenBalances(
  gauge: Gauge,
  account: Account,
  rewardTokenBalances: TokenBalance[],
  market: Market
) {
  let gaugeContract = GaugeContract.bind(Address.fromString(gauge.id));

  // collect claimable CRV
  let claimableCrv = gaugeContract.try_claimable_tokens(Address.fromString(account.id));
  if (!claimableCrv.reverted) {
    rewardTokenBalances.push(
      new TokenBalance(market.rewardTokens[0], account.id, claimableCrv.value)
    );
  }

  // different gauge types use different APIs for reward tokens
  switch (gauge.version) {
    case GaugeVersion.LIQUIDITY_GAUGE_REWARD:
      let rewardedToken = gaugeContract.try_rewarded_token();
      let claimableRewardTotal = gaugeContract.try_claimable_reward(Address.fromString(account.id));
      let claimedRewards = gaugeContract.try_claimed_rewards_for(Address.fromString(account.id));

      if (!rewardedToken.reverted && !claimableRewardTotal.reverted && !claimedRewards.reverted) {
        let claimableRewards = claimableRewardTotal.value.minus(claimedRewards.value);
        rewardTokenBalances.push(
          new TokenBalance(rewardedToken.value.toHexString(), account.id, claimableRewards)
        );
      }
      break;
    case GaugeVersion.LIQUIDITY_GAUGE_V1:
      // do nothing, no reward tokens
      break;
    case GaugeVersion.LIQUIDITY_GAUGE_V2:
      for (let i: i32 = 1; i < market.rewardTokens.length; i++) {
        let claimableCustomRewardToken = gaugeContract.try_claimable_reward1(
          Address.fromString(account.id),
          Address.fromString(market.rewardTokens[i])
        );

        if (!claimableCustomRewardToken.reverted) {
          rewardTokenBalances.push(
            new TokenBalance(market.rewardTokens[i], account.id, claimableCustomRewardToken.value)
          );
        }
      }
      break;
    case GaugeVersion.LIQUIDITY_GAUGE_V3:
    // handle V3 as default case
    default:
      for (let i: i32 = 1; i < market.rewardTokens.length; i++) {
        let claimableCustomRewardToken = gaugeContract.try_claimable_reward_write(
          Address.fromString(account.id),
          Address.fromString(market.rewardTokens[i])
        );

        if (!claimableCustomRewardToken.reverted) {
          rewardTokenBalances.push(
            new TokenBalance(market.rewardTokens[i], account.id, claimableCustomRewardToken.value)
          );
        }
      }
      break;
  }
}

/**
 * Handles event of gauge token transfer from one account to another
 * @param gauge
 * @param event
 * @returns
 */
function handleGaugeTokenTransfer(gauge: Gauge, event: Transfer): void {
  // ignore 0 value transfer
  if (event.params.value == BigInt.fromI32(0)) {
    return;
  }

  // mint of gauge tokens event is already handled in handleDeposit
  if (event.params.from.toHexString() == ADDRESS_ZERO) {
    return;
  }

  // if receiver is zero-address create transferToZero entity and return - position updates are done handle deposit/withdrawal
  if (event.params.to.toHexString() == ADDRESS_ZERO) {
    let transferToZero = new GaugeTokenTransferToZero(event.transaction.hash.toHexString());
    transferToZero.from = event.params.from;
    transferToZero.to = event.params.to;
    transferToZero.value = event.params.value;
    transferToZero.save();

    gauge.lastTransferToZero = transferToZero.id;
    gauge.save();

    return;
  }

  transferGaugeToken(gauge, event, event.params.from, event.params.to, event.params.value);
}

/**
 * Handles event of reward token transfer. We know it is reward claim because `from` is gauge itself.
 * @param gauge
 * @param event
 * @returns
 */
function handleRewardTokenClaim(gauge: Gauge, event: Transfer): void {
  // ignore 0 value transfer
  if (event.params.value == BigInt.fromI32(0)) {
    return;
  }

  // get gauge
  let gaugeContract = GaugeContract.bind(Address.fromString(gauge.id));

  //// Collect data for position update after reward token has been claimed by user

  // user who gets the reward token
  let account = getOrCreateAccount(event.params.to);

  // market (gauge)
  let market = Market.load(gauge.id) as Market;

  // number of gauge tokens burned by user - none in this case
  let outputTokenAmount = BigInt.fromI32(0);

  // number of LP tokens withdrawn by user - none in this case
  let inputTokenAmounts = [];

  // number of reward tokens claimed by user in this transaction
  // this events tracks aquiring one reward token specifically
  let rewardTokenAmounts: TokenBalance[] = [];
  let rewardToken = event.address.toHexString();
  let rewardTokenBalance = new TokenBalance(rewardToken, account.id, event.params.value);
  rewardTokenAmounts.push(rewardTokenBalance);

  // total number of gauge tokens owned by user - no change in this case
  let accountLiquidity = getOrCreateAccountLiquidity(account, gauge);
  let accountGaugeTokenBalance = accountLiquidity.balance;

  // inputTokenBalance -> number of LP tokens that can be redeemed by accounts's gauge tokens
  // in this case it is working balance of user (takes into account CRV vote boosting)
  let inputTokenBalances: TokenBalance[] = [];
  let inputBalance = gaugeContract.try_working_balances(Address.fromString(account.id));
  if (!inputBalance.reverted) {
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, inputBalance.value));
  } else {
    // in case working balance can't be fetched, assume inputTokenBalance is equal to gauge token balance (no boost)
    inputTokenBalances.push(new TokenBalance(gauge.lpToken, account.id, accountGaugeTokenBalance));
  }

  // update reward token amounts (CRV + custom tokens) claimable by user
  let rewardTokenBalances: TokenBalance[] = [];
  collectRewardTokenBalances(gauge, account, rewardTokenBalances, market);

  // use common function to update position and store transaction
  redeemFromMarket(
    event,
    account,
    market,
    outputTokenAmount,
    inputTokenAmounts,
    rewardTokenAmounts,
    accountGaugeTokenBalance,
    inputTokenBalances,
    rewardTokenBalances,
    null
  );
}

/**
 * Gauge token is transfered - substract from sender's position and add it to receiver's
 * @param gauge
 * @param event
 */
function transferGaugeToken(
  gauge: Gauge,
  event: ethereum.Event,
  from: Address,
  to: Address,
  value: BigInt
) {
  let gaugeContract = GaugeContract.bind(Address.fromString(gauge.id));

  // sender
  let fromAccount = getOrCreateAccount(from);

  // market (gauge)
  let market = Market.load(gauge.id) as Market;

  // outputTokenAmount - number of gauge tokens transferred
  let tokensTransferred = value;

  // number of LP tokens deposited by user - none in this case
  let fromInputTokenAmounts = [];

  // number of reward tokens claimed by user in this transaction
  let fromRewardTokenAmounts: TokenBalance[] = [];

  // Substract transferred gauge tokens from sender's account
  let fromAccountLiquidity = getOrCreateAccountLiquidity(fromAccount, gauge);
  fromAccountLiquidity.balance = fromAccountLiquidity.balance.minus(tokensTransferred);
  fromAccountLiquidity.save();
  let fromTokenBalance = fromAccountLiquidity.balance;

  // inputTokenBalance -> number of LP tokens that can be redeemed by accounts's gauge tokens
  // in this case it is working balance of user (takes into account CRV vote boosting)
  let fromInputTokenBalances: TokenBalance[] = [];
  let inputBalance = gaugeContract.try_working_balances(Address.fromString(fromAccount.id));
  if (!inputBalance.reverted) {
    fromInputTokenBalances.push(
      new TokenBalance(gauge.lpToken, fromAccount.id, inputBalance.value)
    );
  } else {
    // in case working balance can't be fetched, assume inputTokenBalance is equal to gauge token balance (no boost)
    fromInputTokenBalances.push(new TokenBalance(gauge.lpToken, fromAccount.id, fromTokenBalance));
  }

  // reward token amounts (CRV + custom tokens) claimable by user
  let fromRewardTokenBalances: TokenBalance[] = [];
  collectRewardTokenBalances(gauge, fromAccount, fromRewardTokenBalances, market);

  // receiver
  let transferredTo = to.toHexString();

  // use common function to update position and store transaction of sender
  redeemFromMarket(
    event,
    fromAccount,
    market,
    tokensTransferred,
    fromInputTokenAmounts,
    fromRewardTokenAmounts,
    fromTokenBalance,
    fromInputTokenBalances,
    fromRewardTokenBalances,
    transferredTo
  );

  //// Collect data for receiver's position update

  // receiver
  let toAccount = getOrCreateAccount(to);

  // number of LP tokens deposited by user - none in this case
  let toInputTokenAmounts = [];

  // number of reward tokens claimed by user in this transaction
  let toRewardTokenAmounts: TokenBalance[] = [];

  // add transferred gauge tokens to receiver's account
  let toAccountLiquidity = getOrCreateAccountLiquidity(toAccount, gauge);
  toAccountLiquidity.balance = toAccountLiquidity.balance.plus(tokensTransferred);
  toAccountLiquidity.save();
  let toTokenBalance = toAccountLiquidity.balance;

  // inputTokenBalance -> number of LP tokens that can be redeemed by receiver's gauge tokens
  // in this case it is working balance of user (takes into account CRV vote boosting)
  let toInputTokenBalances: TokenBalance[] = [];
  let toInputBalance = gaugeContract.try_working_balances(Address.fromString(toAccount.id));
  if (!toInputBalance.reverted) {
    toInputTokenBalances.push(new TokenBalance(gauge.lpToken, toAccount.id, toInputBalance.value));
  } else {
    // in case working balance can't be fetched, assume inputTokenBalance is equal to gauge token balance (no boost)
    toInputTokenBalances.push(new TokenBalance(gauge.lpToken, toAccount.id, toTokenBalance));
  }

  // reward token amounts (CRV + custom tokens) claimable by user
  let toRewardTokenBalances: TokenBalance[] = [];
  collectRewardTokenBalances(gauge, toAccount, toRewardTokenBalances, market);

  // sender
  let transferredFrom = from.toHexString();

  // use common function to update position and store transaction
  investInMarket(
    event,
    toAccount,
    market,
    tokensTransferred,
    toInputTokenAmounts,
    toRewardTokenAmounts,
    toTokenBalance,
    toInputTokenBalances,
    toRewardTokenBalances,
    transferredFrom
  );
}

/**
 * Check if there is a pending transfer of gauge tokens to zero address.
 * If yes, and it is not part of deposit/withdraw events, then update sender's position
 * Otherwise positions will be updated in deposit/withdraw handlers
 * @param event
 * @param pool
 * @returns
 */
function checkPendingTransferToZero(event: ethereum.Event, gauge: Gauge): void {
  // There's no ongoing gauge token transfer to zero address
  if (gauge.lastTransferToZero == null) {
    return;
  }

  // This LP token transfer to zero address is part of deposit/withdraw event, don't handle it here
  if (gauge.lastTransferToZero == event.transaction.hash.toHexString()) {
    return;
  }

  // It's a manual transfer to zero address, not part of deposit/withdraw events
  // Update sender's position accordingly
  let transferTozero = GaugeTokenTransferToZero.load(
    gauge.lastTransferToZero
  ) as GaugeTokenTransferToZero;
  transferGaugeToken(gauge, event, transferTozero.from, transferTozero.to, transferTozero.value);

  gauge.lastTransferToZero = null;
  gauge.save();
}
