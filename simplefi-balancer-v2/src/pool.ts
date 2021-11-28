import { 
  BigInt, 
  ethereum,
  Address,
} from "@graphprotocol/graph-ts"

import { Transfer } from "../generated/templates/WeightedPool/WeightedPool"

import { 
  Pool as PoolEntity, 
  PoolId as PoolIdEntity, 
  Market as MarketEntity,
  Account as AccountEntity,
} from "../generated/schema"

import {
  TokenBalance,
  getOrCreateAccount,
  redeemFromMarket,
  investInMarket,
  ADDRESS_ZERO,
} from "./common"

import {
  getOrCreateLiquidity,
  getOrCreateMint,
  createOrUpdatePositionOnMint,
  getOrCreateBurn,
  createOrUpdatePositionOnBurn,
} from "./market"

export function handleTransfer(event: Transfer): void {
  // If it's transfering zero tokens, no action required
  if (event.params.value == BigInt.fromI32(0)) {
    return
  }

  let poolAddressHex = event.address.toHexString()
  let fromHex = event.params.from.toHexString()
  let toHex = event.params.to.toHexString()

  let poolId = PoolIdEntity.load(poolAddressHex)
  let pool = PoolEntity.load(poolId.poolId)

  if (!pool) {
    return;
  }

  var accountTo: AccountEntity, accountFrom: AccountEntity

  // update account balances
  if (fromHex != ADDRESS_ZERO) {
    let accountLiquidityFrom = getOrCreateLiquidity(pool as PoolEntity, event.params.from)
    accountLiquidityFrom.balance = accountLiquidityFrom.balance.minus(event.params.value)
    accountLiquidityFrom.save()
  }

  if (fromHex != poolAddressHex) {
    let accountLiquidityTo = getOrCreateLiquidity(pool as PoolEntity, event.params.to)
    accountLiquidityTo.balance = accountLiquidityTo.balance.plus(event.params.value)
    accountLiquidityTo.save()
  }
  
  // Protocol doesn't allow user transfers to zero address so only case is burning
  if (toHex == ADDRESS_ZERO) {
    accountFrom = getOrCreateAccount(event.params.from)
    handleBurn(event, pool as PoolEntity, accountFrom)
    return
  } else if (fromHex == ADDRESS_ZERO) {
    accountTo = getOrCreateAccount(event.params.to)
    handleMint(event, pool as PoolEntity, accountTo)
    return
  } 

  // Normal LP transfers
  transferLPToken(event, pool as PoolEntity, event.params.from, event.params.to, event.params.value)
}

function handleMint(event: Transfer, pool: PoolEntity, account: AccountEntity): void {
  let mint = getOrCreateMint(event, pool)
  mint.to = account.id
  mint.transferEventApplied = true
  mint.liquityAmount = event.params.value
  mint.save()
  createOrUpdatePositionOnMint(event, pool, mint)
}

function handleBurn(event: Transfer, pool: PoolEntity, account: AccountEntity): void {
  let burn = getOrCreateBurn(event, pool)
  burn.transferEventApplied = true
  burn.to = account.id
  burn.liquityAmount = event.params.value
  burn.save()
  createOrUpdatePositionOnBurn(event, pool, burn)
}

function transferLPToken(event: ethereum.Event, pool: PoolEntity, from: Address, to: Address, amount: BigInt): void {
  let market = MarketEntity.load(pool.address) as MarketEntity

  var fromAccount = getOrCreateAccount(from)
  let accountLiquidityFrom = getOrCreateLiquidity(pool, from)
  var fromOutputTokenBalance = accountLiquidityFrom.balance
  var fromInputTokenBalances: TokenBalance[] = []

  pool.tokens.forEach((token, index) => {
    let poolReserves = pool.reserves as BigInt[]
    let fromTokenBalance = fromOutputTokenBalance.times(poolReserves[index]).div(pool.totalSupply as BigInt)
    fromInputTokenBalances.push(new TokenBalance(token, fromAccount.id, fromTokenBalance))
  })

  redeemFromMarket(
    event,
    fromAccount,
    market,
    amount,
    [],
    [],
    fromOutputTokenBalance,
    fromInputTokenBalances,
    [],
    to.toHexString()
  )

  var toAccount = getOrCreateAccount(to)
  let accountLiquidityTo = getOrCreateLiquidity(pool, to)
  var toOutputTokenBalance = accountLiquidityTo.balance
  var toInputTokenBalances: TokenBalance[] = []

  pool.tokens.forEach((token, index) => {
    let poolReserves = pool.reserves as BigInt[]
    let toTokenBalance = toOutputTokenBalance.times(poolReserves[index]).div(pool.totalSupply as BigInt)
    toInputTokenBalances.push(new TokenBalance(token, toAccount.id, toTokenBalance))
  })

  investInMarket(
    event,
    toAccount,
    market,
    amount,
    [],
    [],
    toOutputTokenBalance,
    toInputTokenBalances,
    [],
    from.toHexString()
  )
}
