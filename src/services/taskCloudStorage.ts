import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc, writeBatch } from "firebase/firestore";
import { firebaseServices } from "./firebase";
import type { Task } from "../types/task";

export function subscribeUserTasks(
  userId: string,
  onTasks: (tasks: Task[]) => void,
  onError: (error: Error) => void
) {
  if (!firebaseServices) return () => undefined;

  return onSnapshot(
    getTasksCollection(userId),
    (snapshot) => {
      const tasks = snapshot.docs.map((item) => sanitizeTask(item.data() as Task));
      onTasks(tasks);
    },
    onError
  );
}

export async function saveUserTasks(userId: string, tasks: Task[]) {
  if (!firebaseServices) return;

  const tasksCollection = getTasksCollection(userId);
  const snapshot = await getDocs(tasksCollection);
  const nextIds = new Set(tasks.map((task) => task.id));
  const batch = writeBatch(firebaseServices.db);

  snapshot.docs.forEach((item) => {
    if (!nextIds.has(item.id)) {
      batch.delete(item.ref);
    }
  });

  tasks.forEach((task) => {
    batch.set(doc(tasksCollection, task.id), task);
  });

  await batch.commit();
}

export async function deleteUserTask(userId: string, taskId: string) {
  if (!firebaseServices) return;
  await deleteDoc(doc(getTasksCollection(userId), taskId));
}

function getTasksCollection(userId: string) {
  if (!firebaseServices) {
    throw new Error("Firebase config is missing");
  }

  return collection(firebaseServices.db, "users", userId, "tasks");
}

function sanitizeTask(task: Task): Task {
  return {
    ...task,
    reminderAt: null
  };
}
