export function createPermissionsController() {
  return {
    getStatus() {
      return {
        ready: true,
        model: 'structured-permission-scaffold',
        nextActions: [
          'define permission enum',
          'implement permission policy storage',
          'add action preview flow',
        ],
      };
    },
  };
}
