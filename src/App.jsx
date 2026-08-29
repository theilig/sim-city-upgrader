import { useEffect, useMemo, useRef, useState } from "react";
import { goodsData } from "./goodsData.js";

const STORAGE_KEY = "sim-city-upgrader-state-v1";
const REGIONS = ["Green Valley", "Sunny Isles", "Frosty Fjords", "Limestone Cliffs"];
const REGION_TARGET = 160;
const TOTAL_AREA_TARGET = REGION_TARGET * REGIONS.length;
const STALE_UPGRADE_MILLISECONDS = 48 * 60 * 60 * 1000;
const LEVELS = [0, 1, 2, 3, 4, 5, 6];
const GOODS = Object.keys(goodsData).sort((a, b) => a.localeCompare(b));
const BUILDINGS = [...new Set(Object.values(goodsData).map((good) => good.building).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const SHORTCUT_TO_GOOD = Object.entries(goodsData).reduce((shortcuts, [good, data]) => {
  if (data.shortcut && !shortcuts[data.shortcut]) {
    shortcuts[data.shortcut] = good;
  }
  return shortcuts;
}, {});
const ICON_PATHS = {
  add: "M12 5v14M5 12h14",
  check: "m5 12 4 4 10-10",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  map: "M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3ZM9 3v15M15 6v15",
  package: "M21 8l-9-5-9 5 9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8",
  play: "M8 5v14l11-7-11-7Z",
  reset: "M3 12a9 9 0 1 0 3-6.7M3 4v6h6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3",
};

const Icon = ({ label, name }) => (
  <svg aria-hidden="true" className="icon" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
    <title>{label}</title>
    <path d={ICON_PATHS[name]} />
  </svg>
);

const createRegionLevels = () =>
  Object.fromEntries(REGIONS.map((region) => [region, Object.fromEntries(LEVELS.map((level) => [level, 0]))]));

const createRequirement = () => ({
  id: crypto.randomUUID(),
  region: REGIONS[0],
  fromLevel: 0,
  areas: 1,
  items: [],
  createdAt: Date.now(),
});

const createDraft = () => ({
  region: "",
  fromLevel: 0,
  shortcutInput: "",
  items: [],
});

const initialState = {
  regions: createRegionLevels(),
  areaCounts: Object.fromEntries(REGIONS.map((region) => [region, 0])),
  requirements: [],
  inventory: {},
  inProgress: {},
  productionQueue: {},
};

function normalizeRequirement(requirement) {
  if (Array.isArray(requirement.items)) {
    return {
      ...createRequirement(),
      ...requirement,
      createdAt: Number(requirement.createdAt) || Date.now(),
      items: requirement.items.filter((item) => goodsData[item.item]).map((item) => ({ item: item.item, amount: clampNumber(item.amount) || 1 })),
    };
  }

  if (requirement.item && goodsData[requirement.item]) {
    return {
      ...createRequirement(),
      ...requirement,
      createdAt: Number(requirement.createdAt) || Date.now(),
      items: [{ item: requirement.item, amount: clampNumber(requirement.amount) || 1 }],
    };
  }

  return createRequirement();
}

function readStoredState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored) return initialState;
    const regions = { ...createRegionLevels(), ...stored.regions };
    const areaCounts = Object.fromEntries(
      REGIONS.map((region) => [
        region,
        stored.areaCounts?.[region] ?? LEVELS.reduce((total, level) => total + clampNumber(regions[region]?.[level] || 0), 0),
      ]),
    );
    const requirements = Array.isArray(stored.requirements) ? stored.requirements.map(normalizeRequirement).filter((requirement) => requirement.items.length) : [];

    requirements
      .filter((requirement) => requirement.completed)
      .forEach((requirement) => {
        const fromLevel = clampNumber(requirement.fromLevel);
        const toLevel = Math.min(clampNumber(requirement.fromLevel) + 1, 6);
        regions[requirement.region][fromLevel] = Math.max(
          0,
          clampNumber(regions[requirement.region]?.[fromLevel] || 0) - clampNumber(requirement.areas),
        );
        regions[requirement.region][toLevel] = clampNumber(regions[requirement.region]?.[toLevel] || 0) + clampNumber(requirement.areas);
      });
    const activeRequirements = requirements.filter((requirement) => !requirement.completed);
    activeRequirements.forEach((requirement) => {
      const level = clampNumber(requirement.fromLevel);
      const queuedAtLevel = activeRequirements.reduce(
        (total, queuedRequirement) =>
          queuedRequirement.region === requirement.region && clampNumber(queuedRequirement.fromLevel) === level
            ? total + clampNumber(queuedRequirement.areas)
            : total,
        0,
      );
      regions[requirement.region][level] = Math.max(clampNumber(regions[requirement.region]?.[level] || 0), queuedAtLevel);
    });
    return {
      regions,
      areaCounts,
      requirements: activeRequirements,
      inventory: stored.inventory || {},
      inProgress: stored.inProgress || {},
      productionQueue: stored.productionQueue || {},
    };
  } catch {
    return initialState;
  }
}

function clampNumber(value, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.floor(parsed));
}

function displayName(item) {
  return goodsData[item]?.display || item;
}

function formatItemRequirement(itemRequirement) {
  return `${itemRequirement.amount} ${displayName(itemRequirement.item)}`;
}

function formatItemList(items) {
  return items.map(formatItemRequirement).join(", ");
}

function formatElapsedTime(milliseconds) {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function productionBatchSize(item) {
  return Object.keys(goodsData[item]?.ingredients || {}).length === 0 ? 5 : 1;
}

function isBasicItem(item) {
  return Object.keys(goodsData[item]?.ingredients || {}).length === 0;
}

function productionDurationMilliseconds(item) {
  const discountedMinutes = (clampNumber(goodsData[item]?.duration || 0) * 0.8) / 60;
  return Math.ceil(discountedMinutes) * 60 * 1000;
}

function nextProductionStart(item, productionQueue, now) {
  if (isBasicItem(item)) return now;

  const building = goodsData[item]?.building;
  return Object.entries(productionQueue || {}).reduce((latestCompletion, [queuedItem, jobs]) => {
    if (isBasicItem(queuedItem) || goodsData[queuedItem]?.building !== building) return latestCompletion;

    return (Array.isArray(jobs) ? jobs : []).reduce(
      (latestJobCompletion, job) => Math.max(latestJobCompletion, Number(job.completesAt) || 0),
      latestCompletion,
    );
  }, now);
}

function parseShortcutInput(value) {
  const totals = {};
  let numberBuffer = "";
  let letters = "";

  Array.from(value).forEach((character) => {
    if (/\d/.test(character)) {
      if (letters) {
        letters = "";
        numberBuffer = "";
      }
      numberBuffer += character;
      return;
    }

    if (/[a-z]/i.test(character)) {
      letters += character.toLowerCase();
      if (letters.length === 2) {
        const good = SHORTCUT_TO_GOOD[letters];
        if (good) {
          totals[good] = (totals[good] || 0) + (numberBuffer ? clampNumber(numberBuffer, 1) : 1);
        }
        numberBuffer = "";
        letters = "";
      }
      return;
    }

    numberBuffer = "";
    letters = "";
  });

  return Object.entries(totals).map(([item, amount]) => ({ item, amount }));
}

function consumeQueuedProduction(jobs, quantity) {
  let remaining = quantity;

  return (Array.isArray(jobs) ? jobs : []).flatMap((job) => {
    if (remaining <= 0) return [job];
    const jobAmount = clampNumber(job.amount);
    const consumed = Math.min(jobAmount, remaining);
    remaining -= consumed;
    return jobAmount > consumed ? [{ ...job, amount: jobAmount - consumed }] : [];
  });
}

function addRequirementTree(item, quantity, totals, trail = new Set()) {
  totals[item] = (totals[item] || 0) + quantity;

  if (trail.has(item)) return;
  const nextTrail = new Set(trail);
  nextTrail.add(item);

  const ingredients = goodsData[item]?.ingredients || {};
  Object.entries(ingredients).forEach(([ingredient, count]) => {
    addRequirementTree(ingredient, quantity * count, totals, nextTrail);
  });
}

function calculateRequirementTotals(requirement) {
  const totals = {};
  requirement.items.forEach((itemRequirement) => {
    const quantity = clampNumber(requirement.areas) * clampNumber(itemRequirement.amount);
    if (quantity > 0 && goodsData[itemRequirement.item]) {
      addRequirementTree(itemRequirement.item, quantity, totals);
    }
  });
  return totals;
}

function calculateDirectRequirementTotals(requirement) {
  return requirement.items.reduce((totals, itemRequirement) => {
    const quantity = clampNumber(requirement.areas) * clampNumber(itemRequirement.amount);
    totals[itemRequirement.item] = (totals[itemRequirement.item] || 0) + quantity;
    return totals;
  }, {});
}

function calculateNetRequirementTotals(requirements, inventory, inProgress) {
  const totals = {};
  const expandedShortages = {};
  const queue = [];

  function addDemand(item, quantity) {
    if (!goodsData[item] || quantity <= 0) return;
    totals[item] = (totals[item] || 0) + quantity;
    queue.push(item);
  }

  requirements.forEach((requirement) => {
    Object.entries(calculateDirectRequirementTotals(requirement)).forEach(([item, quantity]) => {
      addDemand(item, quantity);
    });
  });

  let guard = 0;
  while (queue.length && guard < 10000) {
    guard += 1;
    const item = queue.shift();
    const needed = totals[item] || 0;
    const covered = clampNumber(inventory[item] || 0) + clampNumber(inProgress[item] || 0);
    const shortage = Math.max(0, needed - covered);
    const unexpandedShortage = shortage - (expandedShortages[item] || 0);

    if (unexpandedShortage <= 0) continue;

    expandedShortages[item] = shortage;
    Object.entries(goodsData[item]?.ingredients || {}).forEach(([ingredient, count]) => {
      addDemand(ingredient, unexpandedShortage * count);
    });
  }

  return totals;
}

function App() {
  const [state, setState] = useState(readStoredState);
  const [draft, setDraft] = useState(createDraft);
  const [buildingFilter, setBuildingFilter] = useState("All");
  const [bulkInventoryInput, setBulkInventoryInput] = useState("");
  const [draggedRequirementId, setDraggedRequirementId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now);
  const shortcutRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function completeFinishedProduction() {
      const now = Date.now();
      setState((current) => {
        const completedByItem = {};
        const productionQueue = Object.fromEntries(
          Object.entries(current.productionQueue || {}).map(([item, jobs]) => [
            item,
            (Array.isArray(jobs) ? jobs : []).filter((job) => {
              if (Number(job.completesAt) > now) return true;
              completedByItem[item] = (completedByItem[item] || 0) + clampNumber(job.amount);
              return false;
            }),
          ]),
        );
        if (!Object.keys(completedByItem).length) return current;

        const inventory = { ...current.inventory };
        const inProgress = { ...(current.inProgress || {}) };
        Object.entries(completedByItem).forEach(([item, amount]) => {
          inventory[item] = clampNumber(inventory[item] || 0) + amount;
          inProgress[item] = Math.max(0, clampNumber(inProgress[item] || 0) - amount);
        });
        return { ...current, inventory, inProgress, productionQueue };
      });
    }

    completeFinishedProduction();
    const timer = window.setInterval(completeFinishedProduction, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const summary = useMemo(() => {
    const totals = calculateNetRequirementTotals(state.requirements, state.inventory, state.inProgress);

    return Object.entries(totals)
      .map(([item, needed]) => ({
        item,
        needed,
        have: clampNumber(state.inventory[item] || 0),
        inProgress: clampNumber(state.inProgress[item] || 0),
      }))
      .sort((a, b) => {
        const missingFraction = (entry) => Math.max(0, entry.needed - entry.have - entry.inProgress) / entry.needed;
        return missingFraction(b) - missingFraction(a)
          || b.needed - b.have - b.inProgress - (a.needed - a.have - a.inProgress)
          || b.needed - a.needed
          || a.item.localeCompare(b.item);
      });
  }, [state.requirements, state.inventory, state.inProgress]);

  const outstandingCount = (entries) => entries.reduce(
    (total, entry) => total + Math.max(0, entry.needed - entry.have - entry.inProgress),
    0,
  );
  const visibleSummary = summary.filter(
    (entry) => buildingFilter === "All" || goodsData[entry.item]?.building === buildingFilter,
  );
  const visibleOutstandingCount = outstandingCount(visibleSummary.filter((entry) => !isBasicItem(entry.item)));
  const buildingOutstandingCounts = Object.fromEntries(
    BUILDINGS.map((building) => [
      building,
      outstandingCount(summary.filter((entry) => goodsData[entry.item]?.building === building)),
    ]),
  );

  const visibleRequirements = useMemo(
    () => state.requirements.filter((requirement) => !draft.region || requirement.region === draft.region),
    [state.requirements, draft.region],
  );

  const totalAreas = REGIONS.reduce((total, region) => total + clampNumber(state.areaCounts?.[region] || 0), 0);
  const completionPercentage = Math.min(100, Math.round((totalAreas / TOTAL_AREA_TARGET) * 100));

  function updateAreaCount(region, value) {
    setState((current) => ({
      ...current,
      areaCounts: {
        ...(current.areaCounts || {}),
        [region]: clampNumber(value),
      },
    }));
  }

  function updateDraft(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: field === "fromLevel" ? clampNumber(value) : value,
    }));
  }

  function focusShortcut() {
    window.setTimeout(() => {
      shortcutRef.current?.focus();
    }, 0);
  }

  function updateDraftInput(value) {
    setDraft((current) => ({
      ...current,
      shortcutInput: value,
      items: parseShortcutInput(value),
    }));
  }

  function addRequirement() {
    if (!draft.region || !draft.items.length) return;

    setState((current) => {
      const requirements = [...current.requirements];
      const newRequirement = {
        id: crypto.randomUUID(),
        region: draft.region,
        fromLevel: draft.fromLevel,
        areas: 1,
        createdAt: Date.now(),
        items: draft.items.filter((itemRequirement) => goodsData[itemRequirement.item]).map((itemRequirement) => ({ ...itemRequirement, amount: clampNumber(itemRequirement.amount, 1) })),
      };
      const lastRegionIndex = requirements.reduce((lastIndex, requirement, index) => (requirement.region === draft.region ? index : lastIndex), -1);
      const sourceLevel = clampNumber(draft.fromLevel);
      const queuedSourceAreas = current.requirements.reduce(
        (total, requirement) =>
          requirement.region === draft.region && clampNumber(requirement.fromLevel) === sourceLevel ? total + clampNumber(requirement.areas) : total,
        0,
      );
      const recordedSourceAreas = clampNumber(current.regions[draft.region]?.[sourceLevel] || 0);
      const requiredSourceAreas = queuedSourceAreas + clampNumber(newRequirement.areas);

      requirements.splice(lastRegionIndex < 0 ? requirements.length : lastRegionIndex + 1, 0, newRequirement);
      return {
        ...current,
        requirements,
        regions: recordedSourceAreas < requiredSourceAreas
          ? {
              ...current.regions,
              [draft.region]: {
                ...current.regions[draft.region],
                [sourceLevel]: requiredSourceAreas,
              },
            }
          : current.regions,
      };
    });
    setDraft((current) => ({ ...createDraft(), region: current.region }));
    focusShortcut();
  }

  function removeRequirement(id) {
    setState((current) => ({
      ...current,
      requirements: current.requirements.filter((requirement) => requirement.id !== id),
    }));
  }

  function reorderRequirement(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return;

    setState((current) => {
      const requirements = [...current.requirements];
      const draggedIndex = requirements.findIndex((requirement) => requirement.id === draggedId);
      if (draggedIndex < 0 || !requirements.some((requirement) => requirement.id === targetId)) return current;

      const [draggedRequirement] = requirements.splice(draggedIndex, 1);
      const insertionIndex = requirements.findIndex((requirement) => requirement.id === targetId);
      requirements.splice(insertionIndex, 0, draggedRequirement);
      return { ...current, requirements };
    });
  }

  function finishRequirementDrag() {
    setDraggedRequirementId(null);
    setDropTargetId(null);
  }

  function completeRequirement(id) {
    setState((current) => {
      const completedRequirement = current.requirements.find((requirement) => requirement.id === id);
      if (!completedRequirement) return current;

      const fromLevel = clampNumber(completedRequirement.fromLevel);
      const toLevel = Math.min(fromLevel + 1, 6);
      const upgradedAreas = clampNumber(completedRequirement.areas);
      const directItems = calculateDirectRequirementTotals(completedRequirement);
      const inventory = Object.entries(directItems).reduce(
        (updatedInventory, [item, quantity]) => ({
          ...updatedInventory,
          [item]: Math.max(0, clampNumber(updatedInventory[item] || 0) - quantity),
        }),
        current.inventory,
      );

      return {
        ...current,
        inventory,
        regions: {
          ...current.regions,
          [completedRequirement.region]: {
            ...current.regions[completedRequirement.region],
            [fromLevel]: Math.max(0, clampNumber(current.regions[completedRequirement.region]?.[fromLevel] || 0) - upgradedAreas),
            [toLevel]: clampNumber(current.regions[completedRequirement.region]?.[toLevel] || 0) + upgradedAreas,
          },
        },
        requirements: current.requirements.filter((requirement) => requirement.id !== id),
      };
    });
  }

  function canCompleteRequirement(requirement) {
    const requirementTotals = calculateDirectRequirementTotals(requirement);
    return Object.entries(requirementTotals).every(([item, needed]) => clampNumber(state.inventory[item] || 0) >= needed);
  }

  function startMakingItem(item) {
    const ingredients = goodsData[item]?.ingredients || {};
    const batchSize = productionBatchSize(item);
    setState((current) => {
      const now = Date.now();
      const consumedIngredients = Object.entries(ingredients).reduce(
        (updated, [ingredient, quantity]) => {
          const inventoryAmount = clampNumber(updated.inventory[ingredient] || 0);
          const fromInventory = Math.min(inventoryAmount, quantity);
          const stillNeeded = quantity - fromInventory;
          const pendingAmount = clampNumber(updated.inProgress[ingredient] || 0);
          const fromPending = Math.min(pendingAmount, stillNeeded);

          updated.inventory[ingredient] = inventoryAmount - fromInventory;
          if (fromPending > 0) {
            updated.inProgress[ingredient] = pendingAmount - fromPending;
            updated.productionQueue[ingredient] = consumeQueuedProduction(
              updated.productionQueue[ingredient],
              fromPending,
            );
          }
          return updated;
        },
        {
          inventory: { ...current.inventory },
          inProgress: { ...(current.inProgress || {}) },
          productionQueue: { ...(current.productionQueue || {}) },
        },
      );
      const startsAt = nextProductionStart(item, consumedIngredients.productionQueue, now);
      const completesAt = startsAt + productionDurationMilliseconds(item);

      return {
        ...current,
        inventory: consumedIngredients.inventory,
        inProgress: {
          ...consumedIngredients.inProgress,
          [item]: clampNumber(consumedIngredients.inProgress[item] || 0) + batchSize,
        },
        productionQueue: {
          ...consumedIngredients.productionQueue,
          [item]: [
            ...(Array.isArray(consumedIngredients.productionQueue[item]) ? consumedIngredients.productionQueue[item] : []),
            { amount: batchSize, startsAt, completesAt },
          ],
        },
      };
    });
  }

  function finishMakingItem(item) {
    setState((current) => {
      const inProgress = clampNumber(current.inProgress?.[item] || 0);
      if (inProgress <= 0) return current;
      const jobs = Array.isArray(current.productionQueue?.[item]) ? current.productionQueue[item] : [];
      const firstJob = jobs[0];
      const finishedAmount = Math.min(
        firstJob ? clampNumber(firstJob.amount) || productionBatchSize(item) : productionBatchSize(item),
        inProgress,
      );
      const remainingJobs = firstJob ? jobs.slice(1) : jobs;

      return {
        ...current,
        inventory: {
          ...current.inventory,
          [item]: clampNumber(current.inventory[item] || 0) + finishedAmount,
        },
        inProgress: {
          ...(current.inProgress || {}),
          [item]: inProgress - finishedAmount,
        },
        productionQueue: {
          ...(current.productionQueue || {}),
          [item]: remainingJobs,
        },
      };
    });
  }

  function updateInventory(item, value) {
    setState((current) => ({
      ...current,
      inventory: {
        ...current.inventory,
        [item]: clampNumber(value),
      },
    }));
  }

  function applyBulkInventory(operation) {
    const parsedItems = parseShortcutInput(bulkInventoryInput);
    if (!parsedItems.length) return;

    setState((current) => {
      const inventory = { ...current.inventory };
      parsedItems.forEach(({ item, amount }) => {
        const currentAmount = clampNumber(inventory[item] || 0);
        if (operation === "update") inventory[item] = amount;
        if (operation === "add") inventory[item] = currentAmount + amount;
        if (operation === "subtract") inventory[item] = Math.max(0, currentAmount - amount);
      });
      return { ...current, inventory };
    });
    setBulkInventoryInput("");
  }

  function resetAll() {
    setState(initialState);
    setDraft(createDraft());
    setBuildingFilter("All");
  }

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <h1>Residential Upgrade Tracker</h1>
          <p>Track four regions, plan upgrades, and roll every final item into its ingredient list.</p>
        </div>
        <button className="ghost-button" type="button" onClick={resetAll} title="Reset tracker">
          <Icon label="Reset" name="reset" />
          Reset
        </button>
      </header>

      <section className="area-summary" aria-labelledby="area-summary-title">
        <div className="area-summary-heading">
          <div>
            <h2 id="area-summary-title">Residential Areas</h2>
            <p>{totalAreas} of {TOTAL_AREA_TARGET} areas</p>
          </div>
          <strong>{completionPercentage}%</strong>
        </div>
        <div className="progress-track area-progress" aria-label={`${completionPercentage}% complete`}>
          <div style={{ width: `${completionPercentage}%` }} />
        </div>
        <div className="area-count-grid">
          {REGIONS.map((region) => {
            const count = clampNumber(state.areaCounts?.[region] || 0);
            return (
              <label className="area-count" key={region}>
                <span>{region}</span>
                <div>
                  <input
                    aria-label={`${region} residential areas`}
                    className="count-input"
                    inputMode="numeric"
                    type="text"
                    value={count}
                    onChange={(event) => updateAreaCount(region, event.target.value)}
                  />
                  <small>/ {REGION_TARGET}</small>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="workspace">
        <div className="panel">
          <div className="section-title split">
            <div>
              <Icon label="Requirements" name="list" />
              <h2>Upgrade Requirements</h2>
            </div>
          </div>

          <div className="requirement-list">
            {visibleRequirements.map((requirement) => {
              const completable = canCompleteRequirement(requirement);
              const elapsedTime = Math.max(0, currentTime - Number(requirement.createdAt));
              const stale = elapsedTime > STALE_UPGRADE_MILLISECONDS;
              return (
                <article
                  className={`requirement-card ${completable ? "completable" : ""} ${stale ? "stale" : ""} ${draggedRequirementId === requirement.id ? "dragging" : ""} ${dropTargetId === requirement.id ? "drop-target" : ""}`}
                  key={requirement.id}
                  onDragOver={(event) => {
                    if (!draggedRequirementId || draggedRequirementId === requirement.id) return;
                    event.preventDefault();
                    setDropTargetId(requirement.id);
                  }}
                  onDragLeave={() => setDropTargetId((current) => (current === requirement.id ? null : current))}
                  onDrop={(event) => {
                    event.preventDefault();
                    reorderRequirement(draggedRequirementId, requirement.id);
                    finishRequirementDrag();
                  }}
                >
                  <div className="submitted-line">
                    <span
                      className="drag-handle"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", requirement.id);
                        setDraggedRequirementId(requirement.id);
                      }}
                      onDragEnd={finishRequirementDrag}
                      role="button"
                      tabIndex={0}
                      title="Drag to reorder"
                    >
                      <Icon label="Drag to reorder" name="grip" />
                    </span>
                    <button
                      className="check-button"
                      type="button"
                      onClick={() => completeRequirement(requirement.id)}
                      title="Complete upgrade"
                    >
                      <Icon label="Complete upgrade" name="check" />
                    </button>
                    <div>
                      <strong>
                        {requirement.region}
                      </strong>
                      <span>{formatItemList(requirement.items)}</span>
                      <small className="upgrade-age">Added {formatElapsedTime(elapsedTime)} ago{stale ? " · Consider resetting" : ""}</small>
                    </div>
                    <button className="icon-button" type="button" onClick={() => removeRequirement(requirement.id)} title="Remove requirement">
                      <Icon label="Remove" name="trash" />
                    </button>
                  </div>
                </article>
              );
            })}
            {!visibleRequirements.length && (
              <p className="empty">{draft.region ? `No upgrades for ${draft.region}.` : "Submitted upgrade requirements will appear here."}</p>
            )}
          </div>

          <div className="composer composer-bottom">
            <div className="composer-fields">
              <select aria-label="Region" value={draft.region} onChange={(event) => updateDraft("region", event.target.value)}>
                <option value="">All regions</option>
                {REGIONS.map((region) => (
                  <option value={region} key={region}>{region}</option>
                ))}
              </select>
              <label className="shortcut-field">
                <span>Shortcuts</span>
                <input
                  ref={shortcutRef}
                  autoComplete="off"
                  inputMode="text"
                  placeholder="2nl3ml2fc"
                  value={draft.shortcutInput}
                  onChange={(event) => updateDraftInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      addRequirement();
                    }
                  }}
                />
              </label>
            </div>

            <div className="draft-items">
              {draft.items.length > 0 && <p className="compact-items">{formatItemList(draft.items)}</p>}
              {!draft.items.length && <p className="empty compact">Type item shortcuts to preview them here.</p>}
            </div>

            <div className="composer-actions">
              <button className="primary-button" type="button" onClick={addRequirement} disabled={!draft.region || !draft.items.length}>
                <Icon label="Add requirement" name="add" />
                Submit
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="section-title">
            <Icon label="Required items" name="package" />
            <h2>Required Items</h2>
            <span className="required-items-count">{visibleOutstandingCount} needed</span>
          </div>
          <select className="building-filter" value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}>
            <option className={outstandingCount(summary) === 0 ? "complete" : ""}>All</option>
            {BUILDINGS.map((building) => (
              <option className={buildingOutstandingCounts[building] === 0 ? "complete" : ""} key={building}>{building}</option>
            ))}
          </select>
          <div className="summary-list">
            {visibleSummary.map((entry) => {
              const complete = entry.have + entry.inProgress >= entry.needed;
              const batchSize = productionBatchSize(entry.item);
              return (
                <div className={`summary-row ${complete ? "complete" : ""}`} key={entry.item}>
                  <strong>{displayName(entry.item)}</strong>
                  <label>
                    <input className="count-input" inputMode="numeric" type="text" value={entry.have} onChange={(event) => updateInventory(entry.item, event.target.value)} />
                    <span>/ {entry.needed}{entry.inProgress ? ` (${entry.inProgress})` : ""}</span>
                  </label>
                  <div className="summary-actions">
                    <button className="mini-action-button" type="button" onClick={() => startMakingItem(entry.item)} title={`Started making ${batchSize}`}>
                      <Icon label={`Started making ${batchSize}`} name="play" />
                    </button>
                    <button className="mini-action-button" type="button" onClick={() => finishMakingItem(entry.item)} disabled={!entry.inProgress} title={`Finished making ${batchSize}`}>
                      <Icon label={`Finished making ${batchSize}`} name="check" />
                    </button>
                  </div>
                </div>
              );
            })}
            {summary.length === 0 && <p className="empty">Add requirements to see the full item list.</p>}
          </div>
          <div className="bulk-inventory">
            <textarea
              aria-label="Bulk inventory"
              onChange={(event) => setBulkInventoryInput(event.target.value)}
              placeholder="Inventory shortcuts, e.g. 20ml 5wd 2nl"
              rows="3"
              value={bulkInventoryInput}
            />
            <div className="bulk-inventory-actions">
              <button type="button" onClick={() => applyBulkInventory("update")}>Update</button>
              <button type="button" onClick={() => applyBulkInventory("add")}>Add</button>
              <button type="button" onClick={() => applyBulkInventory("subtract")}>Subtract</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
