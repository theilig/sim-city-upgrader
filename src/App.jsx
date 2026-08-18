import { useEffect, useMemo, useRef, useState } from "react";
import { goodsData } from "./goodsData.js";

const STORAGE_KEY = "sim-city-upgrader-state-v1";
const TARGET_LEVEL_SIX = 160;
const REGIONS = ["Green Valley", "Sunny Isles", "Frosty Fjords", "Limestone Cliffs"];
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
});

const createDraft = () => ({
  region: REGIONS[0],
  fromLevel: 0,
  shortcutInput: "",
  items: [],
});

const initialState = {
  regions: createRegionLevels(),
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
      items: requirement.items.filter((item) => goodsData[item.item]).map((item) => ({ item: item.item, amount: clampNumber(item.amount) || 1 })),
    };
  }

  if (requirement.item && goodsData[requirement.item]) {
    return {
      ...createRequirement(),
      ...requirement,
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

function productionBatchSize(item) {
  return Object.keys(goodsData[item]?.ingredients || {}).length === 0 ? 5 : 1;
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
  const [draggedRequirementId, setDraggedRequirementId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const shortcutRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

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
      .sort((a, b) => b.needed - b.have - b.inProgress - (a.needed - a.have - a.inProgress) || b.needed - a.needed || a.item.localeCompare(b.item));
  }, [state.requirements, state.inventory, state.inProgress]);

  const pendingByRegionLevel = useMemo(() => {
    const pending = createRegionLevels();
    state.requirements.forEach((requirement) => {
      pending[requirement.region][requirement.fromLevel] += clampNumber(requirement.areas);
    });
    return pending;
  }, [state.requirements]);

  const requirementsByRegion = useMemo(
    () =>
      REGIONS.reduce((grouped, region) => {
        grouped[region] = state.requirements.filter((requirement) => requirement.region === region);
        return grouped;
      }, {}),
    [state.requirements],
  );

  const totals = useMemo(() => {
    const levelSix = REGIONS.reduce((sum, region) => sum + clampNumber(state.regions[region]?.[6] || 0), 0);
    const allAreas = REGIONS.reduce(
      (sum, region) =>
        sum +
        LEVELS.reduce(
          (levelSum, level) => levelSum + clampNumber(state.regions[region]?.[level] || 0),
          0,
        ),
      0,
    );
    const itemsNeeded = summary.reduce((sum, entry) => sum + Math.max(entry.needed - entry.have - entry.inProgress, 0), 0);
    return { levelSix, allAreas, itemsNeeded };
  }, [state.regions, summary]);

  function updateRegionLevel(region, level, value) {
    const queuedAreas = clampNumber(pendingByRegionLevel[region]?.[level] || 0);
    setState((current) => ({
      ...current,
      regions: {
        ...current.regions,
        [region]: {
          ...current.regions[region],
          [level]: Math.max(clampNumber(value), queuedAreas),
        },
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

  function updateDraftAndFocus(field, value) {
    updateDraft(field, value);
    focusShortcut();
  }

  function updateDraftInput(value) {
    setDraft((current) => ({
      ...current,
      shortcutInput: value,
      items: parseShortcutInput(value),
    }));
  }

  function addRequirement() {
    if (!draft.items.length) return;

    setState((current) => {
      const requirements = [...current.requirements];
      const newRequirement = {
        id: crypto.randomUUID(),
        region: draft.region,
        fromLevel: draft.fromLevel,
        areas: 1,
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
    setDraft((current) => ({ ...createDraft(), region: current.region, fromLevel: current.fromLevel }));
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
    const completesAt = Date.now() + clampNumber(goodsData[item]?.duration || 0) * 1000;
    setState((current) => ({
      ...current,
      inventory: Object.entries(ingredients).reduce(
        (inventory, [ingredient, quantity]) => ({
          ...inventory,
          [ingredient]: Math.max(0, clampNumber(inventory[ingredient] || 0) - quantity),
        }),
        current.inventory,
      ),
      inProgress: {
        ...(current.inProgress || {}),
        [item]: clampNumber(current.inProgress?.[item] || 0) + batchSize,
      },
      productionQueue: {
        ...(current.productionQueue || {}),
        [item]: [...(Array.isArray(current.productionQueue?.[item]) ? current.productionQueue[item] : []), { amount: batchSize, completesAt }],
      },
    }));
  }

  function finishMakingItem(item) {
    setState((current) => {
      const inProgress = clampNumber(current.inProgress?.[item] || 0);
      if (inProgress <= 0) return current;
      const finishedAmount = Math.min(productionBatchSize(item), inProgress);
      let amountLeftToRemove = finishedAmount;
      const jobs = Array.isArray(current.productionQueue?.[item]) ? current.productionQueue[item] : [];
      const remainingJobs = jobs.flatMap((job) => {
        if (amountLeftToRemove <= 0) return [job];
        const removedAmount = Math.min(clampNumber(job.amount), amountLeftToRemove);
        amountLeftToRemove -= removedAmount;
        const remainingAmount = clampNumber(job.amount) - removedAmount;
        return remainingAmount > 0 ? [{ ...job, amount: remainingAmount }] : [];
      });

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

      <section className="stats-band" aria-label="Upgrade totals">
        <div>
          <span>Level 6 Areas</span>
          <strong>
            {totals.levelSix}/{REGIONS.length * TARGET_LEVEL_SIX}
          </strong>
        </div>
        <div>
          <span>Total Areas Tracked</span>
          <strong>{totals.allAreas}</strong>
        </div>
        <div>
          <span>Still Needed</span>
          <strong>{totals.itemsNeeded}</strong>
        </div>
      </section>

      <section className="workspace">
        <div className="panel wide">
          <div className="section-title">
            <Icon label="Regions" name="map" />
            <h2>Regions</h2>
          </div>
          <div className="region-grid">
            {REGIONS.map((region) => {
              const completedAreaEquivalents = LEVELS.reduce(
                (sum, level) =>
                  sum +
                  clampNumber(state.regions[region]?.[level] || 0) * ((level + 1) / LEVELS.length),
                0,
              );
              const progress = Math.min(100, Math.round((completedAreaEquivalents / TARGET_LEVEL_SIX) * 100));
              return (
                <article className="region-card" key={region}>
                  <div className="region-heading">
                    <h3>{region}</h3>
                    <span>{progress}%</span>
                  </div>
                  <div className="progress-track">
                    <div style={{ width: `${progress}%` }} />
                  </div>
                  <div className="level-grid">
                    {LEVELS.map((level) => (
                      <label key={level}>
                        <span>L{level}</span>
                        {(() => {
                          const current = clampNumber(state.regions[region]?.[level] || 0);
                          const pending = clampNumber(pendingByRegionLevel[region]?.[level] || 0);
                          return (
                            <>
                              <input
                                className="count-input"
                                inputMode="numeric"
                                type="text"
                                value={current}
                                onChange={(event) => updateRegionLevel(region, level, event.target.value)}
                              />
                              <small>{pending ? `(${pending})` : ""}</small>
                            </>
                          );
                        })()}
                      </label>
                    ))}
                  </div>
                  {requirementsByRegion[region].length > 0 && (
                    <div className="region-upgrades">
                      {requirementsByRegion[region].map((requirement) => (
                        <div className={`region-upgrade-line ${canCompleteRequirement(requirement) ? "completable" : ""}`} key={requirement.id}>
                          <strong>
                            {requirement.areas > 1 ? `${requirement.areas} x ` : ""}L{requirement.fromLevel} to L{requirement.fromLevel + 1}
                          </strong>
                          <span>{formatItemList(requirement.items)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        <div className="panel wide">
          <div className="section-title split">
            <div>
              <Icon label="Requirements" name="list" />
              <h2>Upgrade Requirements</h2>
            </div>
          </div>

          <div className="composer">
            <div className="composer-fields">
              <select value={draft.region} onChange={(event) => updateDraft("region", event.target.value)}>
                {REGIONS.map((region) => (
                  <option key={region}>{region}</option>
                ))}
              </select>
              <label>
                <span>Step</span>
                <select value={draft.fromLevel} onChange={(event) => updateDraftAndFocus("fromLevel", event.target.value)}>
                  {LEVELS.slice(0, 6).map((level) => (
                    <option value={level} key={level}>
                      L{level} to L{level + 1}
                    </option>
                  ))}
                </select>
              </label>
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
              <button className="primary-button" type="button" onClick={addRequirement} disabled={!draft.items.length}>
                <Icon label="Add requirement" name="add" />
                Submit
              </button>
            </div>
          </div>

          <div className="requirement-list">
            {state.requirements.map((requirement) => {
              const completable = canCompleteRequirement(requirement);
              return (
                <article
                  className={`requirement-card ${completable ? "completable" : ""} ${draggedRequirementId === requirement.id ? "dragging" : ""} ${dropTargetId === requirement.id ? "drop-target" : ""}`}
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
                        {requirement.region} · {requirement.areas > 1 ? `${requirement.areas} x ` : ""}L{requirement.fromLevel} to L{requirement.fromLevel + 1}
                      </strong>
                      <span>{formatItemList(requirement.items)}</span>
                    </div>
                    <button className="icon-button" type="button" onClick={() => removeRequirement(requirement.id)} title="Remove requirement">
                      <Icon label="Remove" name="trash" />
                    </button>
                  </div>
                </article>
              );
            })}
            {!state.requirements.length && <p className="empty">Submitted upgrade requirements will appear here.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="section-title">
            <Icon label="Required items" name="package" />
            <h2>Required Items</h2>
          </div>
          <select className="building-filter" value={buildingFilter} onChange={(event) => setBuildingFilter(event.target.value)}>
            <option>All</option>
            {BUILDINGS.map((building) => (
              <option key={building}>{building}</option>
            ))}
          </select>
          <div className="summary-list">
            {summary
              .filter((entry) => buildingFilter === "All" || goodsData[entry.item]?.building === buildingFilter)
              .map((entry) => {
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
        </div>
      </section>
    </main>
  );
}

export default App;
