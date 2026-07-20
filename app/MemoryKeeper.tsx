"use client";

import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type LoveProfile = "coconut" | "xuanmei";
type Visibility = "public" | "private";
type AccessState = "checking" | "locked" | "ready";
type ProfileState = "checking" | "choose" | "ready";
type PetMood = "idle" | "happy" | "excited";

type PhotoEntry = {
  id: string;
  title: string;
  message: string;
  date: string;
  url: string;
  source: "uploaded";
  createdAt: string;
  author: string;
  owner: LoveProfile | null;
  visibility: Visibility;
};

type CheckIn = {
  id: string;
  date: string;
  mood: MoodId;
  note: string;
  author: LoveProfile;
  owner: LoveProfile;
  visibility: Visibility;
  createdAt: string;
};

type Memo = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};

type Cycle = {
  id: string;
  startDate: string;
  endDate: string | null;
  createdAt: string;
};

type MoodId = "happy" | "sad" | "love" | "kiss" | "calm" | "tired";

type MemoryDraft = {
  title: string;
  message: string;
  date: string;
  author: string;
  visibility: Visibility;
};

type CyclePhase = "period" | "follicular" | "ovulation" | "luteal";

type ViewerPan = { x: number; y: number };

type ViewerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  pan: ViewerPan;
};

const MAX_FILE_SIZE = 8 * 1024 * 1024;

const moods: Array<{ id: MoodId; icon: string; label: string; color: string }> = [
  { id: "happy", icon: "😄", label: "开心", color: "sunny" },
  { id: "sad", icon: "🥺", label: "难过", color: "rainy" },
  { id: "love", icon: "🥰", label: "喜欢", color: "lovely" },
  { id: "kiss", icon: "😘", label: "亲亲", color: "kissy" },
  { id: "calm", icon: "😌", label: "平静", color: "calm" },
  { id: "tired", icon: "😪", label: "困困", color: "sleepy" },
];

const moodById = new Map(moods.map((mood) => [mood.id, mood]));

const cyclePhaseLabels: Record<CyclePhase, string> = {
  period: "生理期",
  follicular: "卵泡期",
  ovulation: "排卵期",
  luteal: "黄体期",
};

const petActions = [
  { src: "/pet-actions/normal.webp", alt: "桌宠" },
  { src: "/pet-actions/waving-bouquet.webp", alt: "挥手的桌宠" },
  { src: "/pet-actions/cute-finger-heart.webp", alt: "比心的桌宠" },
  { src: "/pet-actions/eating-strawberry.webp", alt: "吃草莓的桌宠" },
] as const;

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(new Date(year, month, 1));
}

function monthCells(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = Array.from({ length: firstDay }, () => null);

  for (let day = 1; day <= days; day += 1) {
    cells.push(day);
  }

  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function daysFrom(startDate: string, targetDate: string) {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const start = Date.UTC(startYear, startMonth - 1, startDay);
  const target = Date.UTC(targetYear, targetMonth - 1, targetDay);
  return Math.round((target - start) / 86_400_000);
}

function phaseForDate(cycles: Cycle[], value: string): CyclePhase | null {
  const currentCycle = cycles.find((cycle) => {
    const offset = daysFrom(cycle.startDate, value);
    return offset >= 0 && offset < 28;
  });
  if (!currentCycle) {
    return null;
  }

  if (
    currentCycle.endDate &&
    value >= currentCycle.startDate &&
    value <= currentCycle.endDate
  ) {
    return "period";
  }

  const offset = daysFrom(currentCycle.startDate, value);
  if (offset <= 4) {
    return "period";
  }
  if (offset <= 12) {
    return "follicular";
  }
  if (offset <= 15) {
    return "ovulation";
  }
  return "luteal";
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function responseJsonOrNull<T>(response: Response): Promise<T | null> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return null;
  }

  try {
    return await responseJson<T>(response);
  } catch {
    return null;
  }
}

function shouldRetryPhotoUpload(response: Response) {
  return [502, 503, 504, 521, 522, 523, 524].includes(response.status);
}

function waitForPhotoRetry() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 500));
}

function profileName(profile: LoveProfile) {
  return profile === "coconut" ? "椰子" : "炫妹";
}

export function MemoryKeeper() {
  const now = new Date();
  const [accessState, setAccessState] = useState<AccessState>("checking");
  const [profileState, setProfileState] = useState<ProfileState>("checking");
  const [profile, setProfile] = useState<LoveProfile | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [accessError, setAccessError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSubmittingAccess, setIsSubmittingAccess] = useState(false);
  const [isSubmittingProfile, setIsSubmittingProfile] = useState(false);
  const [entries, setEntries] = useState<PhotoEntry[]>([]);
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [memoryZoom, setMemoryZoom] = useState(1);
  const [memoryPan, setMemoryPan] = useState<ViewerPan>({ x: 0, y: 0 });
  const [isPanningMemory, setIsPanningMemory] = useState(false);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft>({
    title: "",
    message: "",
    date: localDateKey(),
    author: "我们",
    visibility: "public",
  });
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [memoryStatus, setMemoryStatus] = useState("");
  const [calendarYear, setCalendarYear] = useState(now.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(now.getMonth());
  const [selectedDate, setSelectedDate] = useState(localDateKey());
  const [selectedMood, setSelectedMood] = useState<MoodId>("happy");
  const [checkInNote, setCheckInNote] = useState("");
  const [checkInVisibility, setCheckInVisibility] = useState<Visibility>("public");
  const [checkInStatus, setCheckInStatus] = useState("");
  const [memoTitle, setMemoTitle] = useState("");
  const [memoContent, setMemoContent] = useState("");
  const [memoStatus, setMemoStatus] = useState("");
  const [cycleStartDate, setCycleStartDate] = useState(localDateKey());
  const [cycleEndDate, setCycleEndDate] = useState("");
  const [cycleEndEdits, setCycleEndEdits] = useState<Record<string, string>>({});
  const [cycleStatus, setCycleStatus] = useState("");
  const [showPasswordSettings, setShowPasswordSettings] = useState(false);
  const [currentProfilePassword, setCurrentProfilePassword] = useState("");
  const [nextProfilePassword, setNextProfilePassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [petMood, setPetMood] = useState<PetMood>("idle");
  const [petActionIndex, setPetActionIndex] = useState(0);
  const [petImageReady, setPetImageReady] = useState(() =>
    petActions.map((_, index) => index === 0),
  );
  const previewUrlRef = useRef("");
  const petTimer = useRef<number | null>(null);
  const viewerGestureRef = useRef<ViewerGesture | null>(null);
  const pendingPetActionIndex = useRef<number | null>(null);

  useEffect(() => {
    let ignore = false;

    async function checkAccess() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await responseJson<{ authenticated?: boolean }>(response);
        if (!ignore) {
          setAccessState(payload.authenticated ? "ready" : "locked");
        }
      } catch {
        if (!ignore) {
          setAccessError("暂时无法确认访问状态，请稍后重试。");
          setAccessState("locked");
        }
      }
    }

    checkAccess();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (accessState !== "ready") {
      return;
    }

    let ignore = false;

    async function checkProfile() {
      try {
        const response = await fetch("/api/auth/profile", { cache: "no-store" });
        const payload = await responseJson<{
          authenticated?: boolean;
          profile?: LoveProfile | null;
        }>(response);
        if (ignore) {
          return;
        }
        if (!payload.authenticated) {
          setAccessState("locked");
          return;
        }
        setProfile(payload.profile ?? null);
        setProfileState(payload.profile ? "ready" : "choose");
      } catch {
        if (!ignore) {
          setProfileError("暂时无法确认个人身份，请稍后重试。");
          setProfileState("choose");
        }
      }
    }

    checkProfile();

    return () => {
      ignore = true;
    };
  }, [accessState]);

  useEffect(() => {
    if (profileState !== "ready" || !profile) {
      return;
    }

    let ignore = false;

    async function loadPrivateSpace() {
      try {
        const [photosResponse, checkInsResponse, memosResponse] = await Promise.all([
          fetch("/api/photos", { cache: "no-store" }),
          fetch("/api/check-ins", { cache: "no-store" }),
          fetch("/api/memos", { cache: "no-store" }),
        ]);
        if (
          photosResponse.status === 401 ||
          checkInsResponse.status === 401 ||
          memosResponse.status === 401
        ) {
          if (!ignore) {
            setProfile(null);
            setProfileState("choose");
          }
          return;
        }
        if (!photosResponse.ok || !checkInsResponse.ok || !memosResponse.ok) {
          return;
        }

        const [photosPayload, checkInsPayload, memosPayload] = await Promise.all([
          responseJson<{ photos?: PhotoEntry[] }>(photosResponse),
          responseJson<{ checkIns?: CheckIn[] }>(checkInsResponse),
          responseJson<{ memos?: Memo[] }>(memosResponse),
        ]);

        let cyclePayload: { cycles?: Cycle[] } | null = null;
        if (profile === "coconut") {
          const cyclesResponse = await fetch("/api/cycle", { cache: "no-store" });
          if (cyclesResponse.ok) {
            cyclePayload = await responseJson<{ cycles?: Cycle[] }>(cyclesResponse);
          }
        }

        if (!ignore) {
          setEntries(photosPayload.photos ?? []);
          setCheckIns(checkInsPayload.checkIns ?? []);
          setMemos(memosPayload.memos ?? []);
          setCycles(cyclePayload?.cycles ?? []);
          setCycleEndEdits({});
        }
      } catch {
        // Keep the last visible state while the local tunnel reconnects.
      }
    }

    loadPrivateSpace();

    return () => {
      ignore = true;
    };
  }, [profile, profileState]);

  useEffect(() => {
    const images = petActions.map(({ src }) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      return image;
    });

    return () => {
      images.forEach((image) => {
        image.src = "";
      });
    };
  }, []);

  useEffect(() => {
    const pendingIndex = pendingPetActionIndex.current;
    if (pendingIndex === null || !petImageReady[pendingIndex]) {
      return;
    }

    pendingPetActionIndex.current = null;
    setPetActionIndex(pendingIndex);
  }, [petImageReady]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (petTimer.current) {
        window.clearTimeout(petTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedMemoryId) {
      return;
    }

    function handleViewerKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedMemoryId(null);
        setMemoryZoom(1);
        setMemoryPan({ x: 0, y: 0 });
        setIsPanningMemory(false);
        viewerGestureRef.current = null;
      }
      if (event.key === "ArrowLeft") {
        const currentIndex = entries.findIndex((entry) => entry.id === selectedMemoryId);
        if (currentIndex >= 0 && entries.length > 1) {
          setSelectedMemoryId(entries[(currentIndex - 1 + entries.length) % entries.length].id);
          resetMemoryPreview();
        }
      }
      if (event.key === "ArrowRight") {
        const currentIndex = entries.findIndex((entry) => entry.id === selectedMemoryId);
        if (currentIndex >= 0 && entries.length > 1) {
          setSelectedMemoryId(entries[(currentIndex + 1) % entries.length].id);
          resetMemoryPreview();
        }
      }
    }

    window.addEventListener("keydown", handleViewerKeyDown);
    return () => window.removeEventListener("keydown", handleViewerKeyDown);
  }, [entries, selectedMemoryId]);

  const checkInsByDate = useMemo(
    () => new Map(checkIns.map((checkIn) => [`${checkIn.owner}:${checkIn.date}`, checkIn])),
    [checkIns],
  );
  const calendarDays = useMemo(
    () => monthCells(calendarYear, calendarMonth),
    [calendarMonth, calendarYear],
  );
  const entriesWithPhotos = useMemo(() => entries.filter((entry) => entry.url), [entries]);
  const publicMemories = entries.filter((entry) => entry.visibility === "public").length;
  const privateMemories = entries.filter((entry) => entry.visibility === "private").length;
  const featuredEntry = entriesWithPhotos[0] ?? null;
  const selectedMemory = selectedMemoryId
    ? entries.find((entry) => entry.id === selectedMemoryId) ?? null
    : null;
  const selectedCheckIn = profile
    ? checkInsByDate.get(`${profile}:${selectedDate}`)
    : undefined;
  const selectedMoodInfo = moodById.get(selectedMood) ?? moods[0];
  const today = localDateKey();
  function reactToPet(mood: Exclude<PetMood, "idle"> = "happy") {
    setPetActionIndex((current) => {
      const next = (current + 1) % petActions.length;
      if (petImageReady[next]) {
        return next;
      }

      pendingPetActionIndex.current = next;
      return current;
    });
    setPetMood(mood);
    if (petTimer.current) {
      window.clearTimeout(petTimer.current);
    }
    petTimer.current = window.setTimeout(
      () => setPetMood("idle"),
      mood === "excited" ? 2600 : 1800,
    );
  }

  function replaceFile(nextFile: File | null) {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const nextPreviewUrl = nextFile ? URL.createObjectURL(nextFile) : "";
    previewUrlRef.current = nextPreviewUrl;
    setFile(nextFile);
    setPreviewUrl(nextPreviewUrl);
  }

  function openMemory(entry: PhotoEntry) {
    setSelectedMemoryId(entry.id);
    resetMemoryPreview();
  }

  function closeMemory() {
    setSelectedMemoryId(null);
    resetMemoryPreview();
  }

  function resetMemoryPreview() {
    setMemoryZoom(1);
    setMemoryPan({ x: 0, y: 0 });
    setIsPanningMemory(false);
    viewerGestureRef.current = null;
  }

  function setViewerZoom(nextZoom: number) {
    const normalizedZoom = Math.min(3, Math.max(1, Math.round(nextZoom * 4) / 4));
    setMemoryZoom(normalizedZoom);
    if (normalizedZoom === 1) {
      setMemoryPan({ x: 0, y: 0 });
    }
  }

  function goToMemory(offset: number) {
    if (!selectedMemoryId || entries.length < 2) {
      return;
    }

    const currentIndex = entries.findIndex((entry) => entry.id === selectedMemoryId);
    const nextIndex = (currentIndex + offset + entries.length) % entries.length;
    setSelectedMemoryId(entries[nextIndex].id);
    resetMemoryPreview();
  }

  function handleViewerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!selectedMemory?.url) {
      return;
    }

    viewerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pan: memoryPan,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = viewerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || memoryZoom <= 1) {
      return;
    }

    const horizontalLimit = (memoryZoom - 1) * 320;
    const verticalLimit = (memoryZoom - 1) * 420;
    const nextPan = {
      x: Math.max(-horizontalLimit, Math.min(horizontalLimit, gesture.pan.x + event.clientX - gesture.startX)),
      y: Math.max(-verticalLimit, Math.min(verticalLimit, gesture.pan.y + event.clientY - gesture.startY)),
    };
    setMemoryPan(nextPan);
    setIsPanningMemory(true);
  }

  function finishViewerPointer(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    const gesture = viewerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const horizontalDistance = event.clientX - gesture.startX;
    const verticalDistance = event.clientY - gesture.startY;
    viewerGestureRef.current = null;
    setIsPanningMemory(false);

    if (
      !cancelled &&
      memoryZoom === 1 &&
      Math.abs(horizontalDistance) > 48 &&
      Math.abs(horizontalDistance) > Math.abs(verticalDistance)
    ) {
      goToMemory(horizontalDistance < 0 ? 1 : -1);
    }
  }

  function handleViewerWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!selectedMemory?.url) {
      return;
    }

    event.preventDefault();
    setViewerZoom(memoryZoom + (event.deltaY < 0 ? 0.25 : -0.25));
  }

  function handleViewerDoubleClick() {
    if (!selectedMemory?.url) {
      return;
    }

    if (memoryZoom > 1) {
      resetMemoryPreview();
      return;
    }

    setViewerZoom(2);
  }

  function handlePetKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      reactToPet();
    }
  }

  function markPetImageReady(index: number) {
    setPetImageReady((current) => {
      if (current[index]) {
        return current;
      }

      const next = [...current];
      next[index] = true;
      return next;
    });
  }

  async function handleMasterLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingAccess(true);
    setAccessError("");

    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: masterPassword }),
      });
      const payload = await responseJson<{ error?: string }>(response);
      if (!response.ok) {
        setAccessError(payload.error || "共同密码不正确，请再试一次。");
        return;
      }
      setMasterPassword("");
      setAccessState("ready");
    } catch {
      setAccessError("暂时无法打开回忆册，请稍后重试。");
    } finally {
      setIsSubmittingAccess(false);
    }
  }

  async function handleProfileLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmittingProfile(true);
    setProfileError("");

    try {
      const response = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: profilePassword }),
      });
      const payload = await responseJson<{ error?: string; profile?: LoveProfile }>(response);
      if (!response.ok || !payload.profile) {
        setProfileError(payload.error || "第二道密码不正确，请再试一次。");
        return;
      }
      setProfilePassword("");
      setProfile(payload.profile);
      setMemoryDraft((current) => ({ ...current, author: payload.profile ?? "我们" }));
      setProfileState("ready");
    } catch {
      setProfileError("暂时无法进入个人页面，请稍后重试。");
    } finally {
      setIsSubmittingProfile(false);
    }
  }

  async function switchProfile() {
    await fetch("/api/auth/profile", { method: "DELETE" });
    setProfile(null);
    closeMemory();
    setProfilePassword("");
    setProfileError("");
    setProfileState("choose");
  }

  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    setProfile(null);
    closeMemory();
    setEntries([]);
    setCheckIns([]);
    setMemos([]);
    setCycles([]);
    setAccessState("locked");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setMemoryStatus("");

    if (!nextFile) {
      replaceFile(null);
      return;
    }
    if (!nextFile.type.startsWith("image/")) {
      setMemoryStatus("请选择一张图片文件。");
      event.target.value = "";
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) {
      setMemoryStatus("照片请控制在 8MB 以内。");
      event.target.value = "";
      return;
    }
    replaceFile(nextFile);
  }

  async function handleMemorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const title = memoryDraft.title.trim();
    const message = memoryDraft.message.trim();

    if (!title && !message) {
      setMemoryStatus("先写下一句标题或想说的话吧。");
      return;
    }

    setMemoryStatus("正在塞进回忆册...");
    const formData = new FormData();
    if (file) {
      formData.set("photo", file);
    }
    formData.set("title", title);
    formData.set("message", message);
    formData.set("date", memoryDraft.date);
    formData.set("author", memoryDraft.author);
    formData.set("visibility", memoryDraft.visibility);
    formData.set("uploadId", crypto.randomUUID());

    try {
      let response: Response | null = null;
      let requestError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetch("/api/photos", {
            method: "POST",
            body: formData,
            cache: "no-store",
          });
          if (!shouldRetryPhotoUpload(response) || attempt === 1) {
            break;
          }
        } catch (error) {
          requestError = error;
          if (attempt === 1) {
            break;
          }
        }

        setMemoryStatus("上传连接断了一下，正在再试一次...");
        await waitForPhotoRetry();
      }

      if (!response) {
        throw requestError instanceof Error ? requestError : new Error("Photo upload failed");
      }
      if (response.status === 401) {
        setProfile(null);
        setProfileState("choose");
        return;
      }
      const payload = await responseJsonOrNull<{ error?: string; photo?: PhotoEntry }>(response);
      if (!response.ok || !payload?.photo) {
        setMemoryStatus(
          payload?.error ||
            `照片上传没有完成（连接状态 ${response.status}），请再试一次。`,
        );
        return;
      }

      setEntries((current) => [payload.photo as PhotoEntry, ...current]);
      setMemoryDraft({
        title: "",
        message: "",
        date: localDateKey(),
        author: profile ?? "我们",
        visibility: "public",
      });
      replaceFile(null);
      form.reset();
      reactToPet("excited");
      setMemoryStatus("好嘞，已经放进回忆册了。");
    } catch {
      setMemoryStatus("照片上传连接断开了，已经重试过一次。请检查网络后再试。");
    }
  }

  async function removeMemory(entry: PhotoEntry) {
    try {
      const response = await fetch(`/api/photos/${entry.id}`, { method: "DELETE" });
      if (response.status === 401) {
        setProfile(null);
        setProfileState("choose");
        return;
      }
      if (!response.ok) {
        const payload = await responseJson<{ error?: string }>(response);
        setMemoryStatus(payload.error || "暂时无法删除这条回忆。");
        return;
      }
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      if (selectedMemoryId === entry.id) {
        closeMemory();
      }
    } catch {
      setMemoryStatus("暂时无法删除这条回忆。");
    }
  }

  function chooseCalendarDate(value: string) {
    setSelectedDate(value);
    const record = profile ? checkInsByDate.get(`${profile}:${value}`) : undefined;
    setSelectedMood(record?.mood ?? "happy");
    setCheckInNote(record?.note ?? "");
    setCheckInVisibility(record?.visibility ?? "public");
    setCheckInStatus("");
  }

  async function saveCheckIn() {
    setCheckInStatus("先把今天收好...");
    try {
      const response = await fetch("/api/check-ins", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          mood: selectedMood,
          note: checkInNote,
          visibility: checkInVisibility,
        }),
      });
      if (response.status === 401) {
        setProfile(null);
        setProfileState("choose");
        return;
      }
      const payload = await responseJson<{ error?: string; checkIn?: CheckIn }>(response);
      if (!response.ok || !payload.checkIn) {
        setCheckInStatus(payload.error || "暂时无法保存心情。");
        return;
      }
      setCheckIns((current) => [
        payload.checkIn as CheckIn,
        ...current.filter((item) => item.id !== payload.checkIn?.id),
      ]);
      setCheckInStatus("好嘞，今天的心情收好啦。" );
    } catch {
      setCheckInStatus("暂时无法保存心情，请稍后重试。");
    }
  }

  async function deleteCheckIn() {
    if (!selectedCheckIn) {
      return;
    }
    try {
      const response = await fetch(`/api/check-ins?date=${selectedDate}`, { method: "DELETE" });
      if (!response.ok) {
        setCheckInStatus("暂时无法删除这次打卡。");
        return;
      }
      setCheckIns((current) => current.filter((item) => item.id !== selectedCheckIn.id));
      setCheckInNote("");
      setSelectedMood("happy");
      setCheckInVisibility("public");
      setCheckInStatus("这次打卡已删除。");
    } catch {
      setCheckInStatus("暂时无法删除这次打卡。");
    }
  }

  async function saveMemo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMemoStatus("正在收好这条备忘...");

    try {
      const response = await fetch("/api/memos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: memoTitle, content: memoContent }),
      });
      if (response.status === 401) {
        setProfile(null);
        setProfileState("choose");
        return;
      }
      const payload = await responseJson<{ error?: string; memo?: Memo }>(response);
      if (!response.ok || !payload.memo) {
        setMemoStatus(payload.error || "暂时无法保存备忘。" );
        return;
      }

      setMemos((current) => [payload.memo as Memo, ...current]);
      setMemoTitle("");
      setMemoContent("");
      setMemoStatus("已经放进只属于你的备忘里。" );
    } catch {
      setMemoStatus("暂时无法保存备忘，请稍后重试。" );
    }
  }

  async function deleteMemo(id: string) {
    try {
      const response = await fetch(`/api/memos?id=${id}`, { method: "DELETE" });
      if (response.status === 401) {
        setProfile(null);
        setProfileState("choose");
        return;
      }
      if (!response.ok) {
        setMemoStatus("暂时无法删除这条备忘。" );
        return;
      }
      setMemos((current) => current.filter((memo) => memo.id !== id));
    } catch {
      setMemoStatus("暂时无法删除这条备忘。" );
    }
  }

  async function saveCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCycleStatus("正在记下这段时间...");

    try {
      const response = await fetch("/api/cycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: cycleStartDate, endDate: cycleEndDate }),
      });
      const payload = await responseJson<{ error?: string; cycle?: Cycle }>(response);
      if (!response.ok || !payload.cycle) {
        setCycleStatus(payload.error || "暂时无法保存记录。" );
        return;
      }
      setCycles((current) => [payload.cycle as Cycle, ...current]);
      setCycleEndDate("");
      setCycleStatus("周期记录已更新。" );
    } catch {
      setCycleStatus("暂时无法保存记录，请稍后重试。" );
    }
  }

  async function updateCycleEnd(cycle: Cycle) {
    const endDate = cycleEndEdits[cycle.id] ?? cycle.endDate ?? "";
    setCycleStatus("正在更新结束日期...");

    try {
      const response = await fetch("/api/cycle", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: cycle.id, endDate }),
      });
      const payload = await responseJson<{ error?: string; cycle?: Cycle }>(response);
      if (!response.ok || !payload.cycle) {
        setCycleStatus(payload.error || "暂时无法更新记录。" );
        return;
      }
      setCycles((current) => current.map((item) => (item.id === cycle.id ? payload.cycle as Cycle : item)));
      setCycleStatus("结束日期已更新。" );
    } catch {
      setCycleStatus("暂时无法更新记录，请稍后重试。" );
    }
  }

  async function deleteCycle(id: string) {
    try {
      const response = await fetch(`/api/cycle?id=${id}`, { method: "DELETE" });
      if (!response.ok) {
        setCycleStatus("暂时无法删除这条记录。" );
        return;
      }
      setCycles((current) => current.filter((cycle) => cycle.id !== id));
      setCycleStatus("这条周期记录已删除。" );
    } catch {
      setCycleStatus("暂时无法删除这条记录。" );
    }
  }

  async function changeOwnPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordStatus("正在更新个人密码...");

    try {
      const response = await fetch("/api/auth/profile/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: currentProfilePassword, nextPassword: nextProfilePassword }),
      });
      const payload = await responseJson<{ error?: string }>(response);
      if (!response.ok) {
        setPasswordStatus(payload.error || "暂时无法修改个人密码。" );
        return;
      }
      setCurrentProfilePassword("");
      setNextProfilePassword("");
      setPasswordStatus("个人密码已更新，公共密码没有变化。" );
    } catch {
      setPasswordStatus("暂时无法修改个人密码，请稍后重试。" );
    }
  }

  function moveMonth(offset: number) {
    const date = new Date(calendarYear, calendarMonth + offset, 1);
    setCalendarYear(date.getFullYear());
    setCalendarMonth(date.getMonth());
  }

  if (accessState !== "ready") {
    return (
      <main className="gate-page">
        <section className="gate-panel" aria-live="polite">
          <p className="eyebrow">coconut × xuanmei</p>
          <h1>椰子和炫妹的小角落</h1>
          {accessState === "checking" ? (
            <p className="gate-copy">正在确认回忆册的门锁...</p>
          ) : (
            <form className="gate-form" onSubmit={handleMasterLogin}>
              <p className="gate-copy">先输一下我们那个共同密码。</p>
              <label>
                共同密码
                <input
                  type="password"
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </label>
              <button type="submit" disabled={isSubmittingAccess}>
                {isSubmittingAccess ? "正在打开..." : "打开回忆册"}
              </button>
              {accessError ? <p className="gate-error" role="alert">{accessError}</p> : null}
            </form>
          )}
        </section>
      </main>
    );
  }

  if (profileState !== "ready" || !profile) {
    return (
      <main className="gate-page">
        <section className="gate-panel" aria-live="polite">
          <p className="eyebrow">Second key</p>
          <h1>好嘞，轮到自己这把钥匙了</h1>
          {profileState === "checking" ? (
            <p className="gate-copy">正在打开属于你的那一页...</p>
          ) : (
            <form className="gate-form" onSubmit={handleProfileLogin}>
              <p className="gate-copy">输入自己的第二道密码。公共区一起看，自己的小本本只留给自己。</p>
              <label>
                第二道密码
                <input
                  type="password"
                  value={profilePassword}
                  onChange={(event) => setProfilePassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  required
                />
              </label>
              <button type="submit" disabled={isSubmittingProfile}>
                {isSubmittingProfile ? "正在进入..." : "进入我的页面"}
              </button>
              {profileError ? <p className="gate-error" role="alert">{profileError}</p> : null}
            </form>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="love-app">
      <button
        type="button"
        className={`desktop-pet desktop-pet-${petMood}`}
        aria-label="和桌宠互动"
        onClick={() => reactToPet()}
        onKeyDown={handlePetKeyDown}
      >
        <span className="desktop-pet-sparkle sparkle-one" aria-hidden="true" />
        <span className="desktop-pet-sparkle sparkle-two" aria-hidden="true" />
        <span className="desktop-pet-sparkle sparkle-three" aria-hidden="true" />
        <span className="desktop-pet-stage">
          {petActions.map((action, index) => (
            <img
              key={action.src}
              className={`desktop-pet-image${index === petActionIndex ? " desktop-pet-image-active" : ""}`}
              src={action.src}
              alt={index === petActionIndex ? action.alt : ""}
              aria-hidden={index === petActionIndex ? undefined : true}
              decoding="async"
              fetchPriority={index === 0 ? "high" : "auto"}
              onLoad={() => markPetImageReady(index)}
            />
          ))}
        </span>
      </button>

      <header className="app-header">
        <a href="#top" className="wordmark" aria-label="回到顶部">
          <span>coconut</span>
          <i aria-hidden="true">×</i>
          <span>xuanmei</span>
        </a>
        <nav aria-label="回忆册导航">
          <a href="#today">今天</a>
          <a href="#calendar">心情</a>
          {profile === "coconut" ? <a href="#cycle">周期</a> : null}
          <a href="#notes">备忘</a>
          <a href="#memories">回忆</a>
        </nav>
        <div className="identity-tools">
          <span className="identity-chip">现在是 {profileName(profile)}</span>
          <button type="button" className="quiet-action" onClick={() => setShowPasswordSettings((current) => !current)}>设置</button>
          <button type="button" className="quiet-action" onClick={switchProfile}>切换</button>
          <button type="button" className="quiet-action" onClick={signOut}>锁定</button>
        </div>
      </header>

      <section id="top" className="private-hero">
        <div className="hero-copy">
          <p className="eyebrow">{profileName(profile)} 的今天</p>
          <h1>今天有啥想记下的没？</h1>
          <p>
            公共区一起看，自己的小本本自己收着。
          </p>
          <div className="hero-actions">
            <a href="#new-memory" className="primary-action">记一笔</a>
            <a href="#calendar" className="secondary-action">今天啥心情？</a>
          </div>
          <div className="memory-stats" aria-label="回忆统计">
            <div><strong>{publicMemories}</strong><span>公共回忆</span></div>
            <div><strong>{privateMemories}</strong><span>只给我的备忘</span></div>
            <div><strong>{checkIns.length}</strong><span>心情印记</span></div>
          </div>
        </div>

        <div className="hero-memento" aria-label="最近一条回忆">
          <div className="memento-image">
            {featuredEntry?.url ? <img src={featuredEntry.url} alt={featuredEntry.title} /> : <span>✦</span>}
          </div>
          <div className="memento-note">
            <span className="visibility-label">{featuredEntry?.visibility === "private" ? "只给我" : "公共区"}</span>
            <time>{featuredEntry?.date || "下一页，等你们来写"}</time>
            <strong>{featuredEntry?.title || "还没有第一条新回忆"}</strong>
            <p>{featuredEntry?.message || "从一句话、一张照片，或今天的心情开始。"}</p>
          </div>
        </div>
      </section>

      <section id="calendar" className="calendar-workspace" aria-label="心情日历">
        <div className="section-intro">
          <div>
            <p className="eyebrow">Mood calendar</p>
            <h2>今天啥心情哇？</h2>
          </div>
        </div>

        <div className="calendar-layout">
          <section className="month-calendar">
            <div className="calendar-title-row">
              <button type="button" className="icon-action" aria-label="上个月" onClick={() => moveMonth(-1)}>←</button>
              <h3>{monthLabel(calendarYear, calendarMonth)}</h3>
              <button type="button" className="icon-action" aria-label="下个月" onClick={() => moveMonth(1)}>→</button>
            </div>
            <div className="weekday-row" aria-hidden="true">
              {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {calendarDays.map((day, index) => {
                if (!day) {
                  return <span className="calendar-blank" key={`blank-${index}`} />;
                }
                const value = dateKey(calendarYear, calendarMonth, day);
                const dayRecords = (["coconut", "xuanmei"] as LoveProfile[])
                  .map((owner) => checkInsByDate.get(`${owner}:${value}`))
                  .filter((record): record is CheckIn => Boolean(record));
                const moodDescription = dayRecords
                  .map((record) => `${profileName(record.owner)} ${moodById.get(record.mood)?.label ?? ""}`)
                  .join("，");
                return (
                  <button
                    type="button"
                    key={value}
                    className={`calendar-day ${value === selectedDate ? "is-selected" : ""} ${value === today ? "is-today" : ""}`}
                    aria-label={`${value}${moodDescription ? `，${moodDescription}` : ""}`}
                    onClick={() => chooseCalendarDate(value)}
                  >
                    <span>{day}</span>
                    {dayRecords.length ? (
                      <span className="mood-markers" aria-hidden="true">
                        {dayRecords.map((record) => {
                          const mood = moodById.get(record.mood);
                          if (!mood) {
                            return null;
                          }
                          return (
                            <b className={`mood-marker ${record.owner} ${mood.color}`} key={record.owner} title={`${profileName(record.owner)}：${mood.label}`}>
                              <span>{mood.icon}</span>
                            </b>
                          );
                        })}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="checkin-editor" aria-label="记录心情">
            <p className="eyebrow">{selectedDate}</p>
            <h3>{selectedCheckIn ? "改一下这天的心情" : "给今天塞个表情"}</h3>
            <div className="mood-picker" aria-label="选择心情">
              {moods.map((mood) => (
                <button
                  type="button"
                  key={mood.id}
                  className={`mood-choice ${selectedMood === mood.id ? "is-active" : ""}`}
                  aria-pressed={selectedMood === mood.id}
                  onClick={() => setSelectedMood(mood.id)}
                >
                  <span>{mood.icon}</span>
                  <small>{mood.label}</small>
                </button>
              ))}
            </div>
            <label className="compact-field">
              要不要叨叨两句
              <textarea value={checkInNote} onChange={(event) => setCheckInNote(event.target.value)} rows={3} placeholder="不写也行。" />
            </label>
            <div className="visibility-switch" role="group" aria-label="心情可见范围">
              <button type="button" className={checkInVisibility === "public" ? "is-active" : ""} aria-pressed={checkInVisibility === "public"} onClick={() => setCheckInVisibility("public")}>
                公共
              </button>
              <button type="button" className={checkInVisibility === "private" ? "is-active" : ""} aria-pressed={checkInVisibility === "private"} onClick={() => setCheckInVisibility("private")}>
                只给我
              </button>
            </div>
            <div className="editor-actions">
              <button type="button" className="primary-button" onClick={saveCheckIn}>保存 {selectedMoodInfo.label}</button>
              {selectedCheckIn ? <button type="button" className="text-action" onClick={deleteCheckIn}>删除</button> : null}
            </div>
            <p className="form-status" role="status">{checkInStatus}</p>
          </section>
        </div>
      </section>

      {profile === "coconut" ? (
        <section id="cycle" className="cycle-workspace" aria-label="椰子的周期日历">
          <div className="section-intro">
            <div>
              <p className="eyebrow">Coconut only</p>
              <h2>椰子的周期小日历</h2>
            </div>
          </div>
          <div className="cycle-layout">
            <section className="cycle-calendar" aria-label={`${monthLabel(calendarYear, calendarMonth)}周期颜色`}>
              <h3>{monthLabel(calendarYear, calendarMonth)}</h3>
              <div className="weekday-row" aria-hidden="true">
                {['日', '一', '二', '三', '四', '五', '六'].map((day) => <span key={`cycle-${day}`}>{day}</span>)}
              </div>
              <div className="cycle-grid">
                {calendarDays.map((day, index) => {
                  if (!day) {
                    return <span className="cycle-day cycle-blank" key={`cycle-blank-${index}`} />;
                  }
                  const value = dateKey(calendarYear, calendarMonth, day);
                  const phase = phaseForDate(cycles, value);
                  return <span className={`cycle-day ${phase ? `is-${phase}` : ""}`} title={phase ? cyclePhaseLabels[phase] : "未记录"} key={value}>{day}</span>;
                })}
              </div>
              <div className="cycle-legend" aria-label="周期颜色说明">
                {(Object.keys(cyclePhaseLabels) as CyclePhase[]).map((phase) => <span className={`cycle-key ${phase}`} key={phase}>{cyclePhaseLabels[phase]}</span>)}
              </div>
            </section>
            <section className="cycle-editor">
              <h3>记录一次生理期</h3>
              <form onSubmit={saveCycle} className="cycle-form">
                <label>开始日期<input type="date" value={cycleStartDate} onChange={(event) => setCycleStartDate(event.target.value)} required /></label>
                <label>结束日期<input type="date" value={cycleEndDate} min={cycleStartDate} onChange={(event) => setCycleEndDate(event.target.value)} /></label>
                <button type="submit" className="primary-button">保存周期</button>
              </form>
              <div className="cycle-history" aria-label="已记录周期">
                {cycles.length ? cycles.slice(0, 5).map((cycle) => (
                  <div className="cycle-record" key={cycle.id}>
                    <strong>{cycle.startDate}</strong>
                    <span>至</span>
                    <input type="date" min={cycle.startDate} value={cycleEndEdits[cycle.id] ?? cycle.endDate ?? ""} onChange={(event) => setCycleEndEdits((current) => ({ ...current, [cycle.id]: event.target.value }))} aria-label={`${cycle.startDate}的结束日期`} />
                    <button type="button" className="text-action" onClick={() => updateCycleEnd(cycle)}>更新</button>
                    <button type="button" className="text-action danger-action" onClick={() => deleteCycle(cycle.id)}>删除</button>
                  </div>
                )) : <p className="utility-empty">还没有记录，从开始日期写起。</p>}
              </div>
              <p className="form-status" role="status">{cycleStatus}</p>
            </section>
          </div>
        </section>
      ) : null}

      <section id="new-memory" className="memory-workspace">
        <div className="section-intro">
          <div>
            <p className="eyebrow">New memory</p>
            <h2>想留的就先放这儿。</h2>
          </div>
        </div>

        <form className="memory-form" onSubmit={handleMemorySubmit}>
          <label className="upload-dropzone">
            <input type="file" accept="image/*" onChange={handleFileChange} />
            {previewUrl ? <img src={previewUrl} alt="待上传照片预览" /> : <span><strong>选择一张照片</strong><small>也可以只写一句话，图片限制 8MB</small></span>}
          </label>
          <div className="memory-fields">
            <div className="field-row">
              <label>
                标题
                <input value={memoryDraft.title} onChange={(event) => setMemoryDraft((current) => ({ ...current, title: event.target.value }))} placeholder="比如：那天的晚风" />
              </label>
              <label>
                日期
                <input type="date" value={memoryDraft.date} onChange={(event) => setMemoryDraft((current) => ({ ...current, date: event.target.value }))} />
              </label>
            </div>
            <div className="field-row author-row">
              <label>
                作者
                <select value={memoryDraft.author} onChange={(event) => setMemoryDraft((current) => ({ ...current, author: event.target.value }))}>
                  <option value="coconut">椰子</option>
                  <option value="xuanmei">炫妹</option>
                  <option value="我们">我们</option>
                </select>
              </label>
              <div className="visibility-control">
                <span>可见范围</span>
                <div className="visibility-switch" role="group" aria-label="回忆可见范围">
                  <button type="button" className={memoryDraft.visibility === "public" ? "is-active" : ""} aria-pressed={memoryDraft.visibility === "public"} onClick={() => setMemoryDraft((current) => ({ ...current, visibility: "public" }))}>
                    公共区
                  </button>
                  <button type="button" className={memoryDraft.visibility === "private" ? "is-active" : ""} aria-pressed={memoryDraft.visibility === "private"} onClick={() => setMemoryDraft((current) => ({ ...current, visibility: "private" }))}>
                    只给我
                  </button>
                </div>
              </div>
            </div>
            <label>
              想说的话
              <textarea value={memoryDraft.message} onChange={(event) => setMemoryDraft((current) => ({ ...current, message: event.target.value }))} rows={5} placeholder="想到啥就记一下，之后再翻出来看。" />
            </label>
            <div className="form-footer">
              <button type="submit" className="primary-button">收藏这一页</button>
              <p className="form-status" role="status">{memoryStatus}</p>
            </div>
          </div>
        </form>
      </section>

      <section id="notes" className="utility-workspace" aria-label="个人备忘和设置">
        <div className="section-intro">
          <div>
            <p className="eyebrow">Private tools</p>
            <h2>自己的小本本</h2>
          </div>
        </div>
        <div className="utility-layout">
          <section className="utility-panel" aria-label="个人备忘录">
            <h3>备忘录</h3>
            <form className="memo-form" onSubmit={saveMemo}>
              <input value={memoTitle} onChange={(event) => setMemoTitle(event.target.value)} placeholder="标题（可不写）" aria-label="备忘标题" />
              <textarea value={memoContent} onChange={(event) => setMemoContent(event.target.value)} rows={4} placeholder="待办、碎碎念，想到啥就记一下。" aria-label="备忘内容" />
              <div className="form-footer"><button type="submit" className="primary-button">添加备忘</button><p className="form-status" role="status">{memoStatus}</p></div>
            </form>
            <div className="memo-list">
              {memos.length ? memos.map((memo) => (
                <article className="memo-item" key={memo.id}>
                  <div><strong>{memo.title || "没有标题"}</strong><p>{memo.content}</p></div>
                  <button type="button" className="text-action danger-action" onClick={() => deleteMemo(memo.id)}>删除</button>
                </article>
              )) : <p className="utility-empty">这里暂时还是空的。</p>}
            </div>
          </section>
          <section className="utility-panel password-panel" aria-label="个人密码设置">
            <div className="utility-heading"><h3>个人密码</h3><button type="button" className="text-action" onClick={() => setShowPasswordSettings((current) => !current)}>{showPasswordSettings ? "收起" : "修改"}</button></div>
            <p>这里只改自己的第二道密码，那个共同密码不动。</p>
            {showPasswordSettings ? (
              <form className="password-form" onSubmit={changeOwnPassword}>
                <label>当前个人密码<input type="password" value={currentProfilePassword} onChange={(event) => setCurrentProfilePassword(event.target.value)} autoComplete="current-password" required /></label>
                <label>新个人密码<input type="password" value={nextProfilePassword} onChange={(event) => setNextProfilePassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
                <button type="submit" className="primary-button">更新个人密码</button>
              </form>
            ) : null}
            <p className="form-status" role="status">{passwordStatus}</p>
          </section>
        </div>
      </section>

      <section id="memories" className="gallery-section">
        <div className="section-intro">
          <div>
            <p className="eyebrow">Album</p>
            <h2>回忆相册</h2>
          </div>
        </div>
        {entries.length ? (
          <div className="album-grid" aria-label="回忆相册">
            {entries.map((entry, index) => (
              <button
                type="button"
                className={`album-tile ${entry.url ? "has-image" : "is-note"}`}
                key={entry.id}
                onClick={() => openMemory(entry)}
                style={{ animationDelay: `${Math.min(index, 12) * 45}ms` }}
                aria-label={`查看 ${entry.date} 的回忆：${entry.title || "今天的小事"}`}
              >
                {entry.url ? (
                  <img src={entry.url} alt={entry.title || "回忆照片"} loading="lazy" decoding="async" />
                ) : (
                  <span className="album-note-mark">{entry.author.slice(0, 1)}</span>
                )}
                <span className="album-caption">
                  <time>{entry.date}</time>
                  <strong>{entry.title || "今天的小事"}</strong>
                </span>
                <span className={entry.visibility === "private" ? "album-badge private" : "album-badge public"}>
                  {entry.visibility === "private" ? "只给我" : "公共"}
                </span>
              </button>
            ))}
          </div>
        ) : <p className="empty-state">还没有回忆，从上面写下第一页吧。</p>}
      </section>

      {selectedMemory ? (
        <div className="memory-viewer" role="dialog" aria-modal="true" aria-label={`${selectedMemory.date} 的回忆`}>
          <button type="button" className="viewer-backdrop" aria-label="关闭回忆查看器" onClick={closeMemory} />
          <section className="viewer-panel">
            <header className="viewer-toolbar">
              <div><time>{selectedMemory.date}</time><span>{selectedMemory.author}</span></div>
              <div className="viewer-toolbar-actions">
                {entries.length > 1 ? <button type="button" className="viewer-icon" title="上一条回忆" aria-label="上一条回忆" onClick={() => goToMemory(-1)}>‹</button> : null}
                {entries.length > 1 ? <button type="button" className="viewer-icon" title="下一条回忆" aria-label="下一条回忆" onClick={() => goToMemory(1)}>›</button> : null}
                <button type="button" className="viewer-icon close-viewer" title="关闭" aria-label="关闭回忆查看器" onClick={closeMemory}>×</button>
              </div>
            </header>
            <div className="viewer-content">
              <div
                className={`viewer-media ${selectedMemory.url ? "has-image" : "is-note"} ${isPanningMemory ? "is-panning" : ""}`}
                onDoubleClick={handleViewerDoubleClick}
                onPointerCancel={(event) => finishViewerPointer(event, true)}
                onPointerDown={handleViewerPointerDown}
                onPointerMove={handleViewerPointerMove}
                onPointerUp={finishViewerPointer}
                onWheel={handleViewerWheel}
              >
                {selectedMemory.url ? (
                  <img src={selectedMemory.url} alt={selectedMemory.title || "回忆照片"} decoding="async" draggable={false} style={{ transform: `translate(${memoryPan.x}px, ${memoryPan.y}px) scale(${memoryZoom})` }} />
                ) : <span>{selectedMemory.author.slice(0, 1)}</span>}
                {selectedMemory.url ? (
                  <div className="viewer-zoom-controls" aria-label="照片缩放" onPointerDown={(event) => event.stopPropagation()}>
                    <button type="button" className="viewer-icon" title="缩小" aria-label="缩小照片" onClick={() => setViewerZoom(memoryZoom - 0.5)}>−</button>
                    <button type="button" className="viewer-zoom-reset" aria-label="恢复原始大小" onClick={resetMemoryPreview}>1:1</button>
                    <button type="button" className="viewer-icon" title="放大" aria-label="放大照片" onClick={() => setViewerZoom(memoryZoom + 0.5)}>+</button>
                  </div>
                ) : null}
              </div>
              <article className="viewer-details">
                <span className={selectedMemory.visibility === "private" ? "private-badge" : "public-badge"}>{selectedMemory.visibility === "private" ? "只给我" : "公共"}</span>
                <h3>{selectedMemory.title || "今天的小事"}</h3>
                <p>{selectedMemory.message || "这一页先留白。"}</p>
                <div className="viewer-detail-footer">
                  <span>记录者：{selectedMemory.author}</span>
                  {selectedMemory.owner === profile || selectedMemory.owner === null ? <button type="button" className="text-action danger-action" onClick={() => removeMemory(selectedMemory)}>删除这条</button> : null}
                </div>
              </article>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
