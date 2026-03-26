#pragma once

// C++/CLI wrapper for PLCSIM Advanced V6 Runtime API.
// Exposes managed .NET methods callable from PacForgeBridge (C# / .NET Framework 4.8).
// The native PLCSIM API uses COM-style C++ vtable interfaces — this wrapper translates
// them to managed types.

#include "SimulationRuntimeApi.h"

using namespace System;
using namespace System::Collections::Generic;
using namespace System::Runtime::InteropServices;

namespace PlcsimBridge {

    /// <summary>
    /// Result of a tag read operation.
    /// </summary>
    public ref class TagReadResult {
    public:
        property bool Success;
        property String^ ErrorMessage;
        property String^ TagName;
        property Object^ Value;
        property String^ DataType; // "Bool", "Int16", "Int32", "Float", "Double"
    };

    /// <summary>
    /// Info about a registered PLCSIM instance.
    /// </summary>
    public ref class PlcsimInstanceInfo {
    public:
        property String^ Name;
        property int Id;
        property String^ OperatingState; // "Off", "Stop", "Run", etc.
    };

    /// <summary>
    /// Managed wrapper for PLCSIM Advanced V6 Runtime API.
    /// Creates virtual controllers, reads/writes IO tags, controls execution.
    /// </summary>
    public ref class PlcsimRuntime {
    private:
        ISimulationRuntimeManager* _manager;
        IInstance* _instance;
        bool _initialized;
        String^ _lastError;

        void SetError(ERuntimeErrorCode code);
        void SetError(String^ message);

    public:
        PlcsimRuntime();
        ~PlcsimRuntime();
        !PlcsimRuntime(); // destructor + OS finalizer

        /// <summary>Initialize the PLCSIM Advanced Runtime API.</summary>
        bool Initialize();

        /// <summary>Register (create) a new virtual controller instance.</summary>
        bool RegisterInstance(String^ instanceName, int cpuType);

        /// <summary>Power on the virtual controller.</summary>
        bool PowerOn(int timeoutMs);

        /// <summary>Power off the virtual controller.</summary>
        bool PowerOff(int timeoutMs);

        /// <summary>Set PLC to RUN mode.</summary>
        bool Run(int timeoutMs);

        /// <summary>Set PLC to STOP mode.</summary>
        bool Stop(int timeoutMs);

        /// <summary>Get current operating state.</summary>
        String^ GetOperatingState();

        /// <summary>Read a Bool tag by symbolic name.</summary>
        TagReadResult^ ReadBool(String^ tagName);

        /// <summary>Read an Int16 tag by symbolic name.</summary>
        TagReadResult^ ReadInt16(String^ tagName);

        /// <summary>Read an Int32 tag by symbolic name.</summary>
        TagReadResult^ ReadInt32(String^ tagName);

        /// <summary>Read a Float (Real) tag by symbolic name.</summary>
        TagReadResult^ ReadFloat(String^ tagName);

        /// <summary>Write a Bool tag by symbolic name.</summary>
        bool WriteBool(String^ tagName, bool value);

        /// <summary>Write an Int16 tag by symbolic name.</summary>
        bool WriteInt16(String^ tagName, short value);

        /// <summary>Write an Int32 tag by symbolic name.</summary>
        bool WriteInt32(String^ tagName, int value);

        /// <summary>Write a Float (Real) tag by symbolic name.</summary>
        bool WriteFloat(String^ tagName, float value);

        /// <summary>Write raw bytes to an IO area (Input/Output/Marker).</summary>
        bool WriteAreaByte(int area, int offset, unsigned char value);

        /// <summary>Read raw bytes from an IO area.</summary>
        unsigned char ReadAreaByte(int area, int offset, bool% success);

        /// <summary>Get the last error message.</summary>
        property String^ LastError {
            String^ get() { return _lastError; }
        }

        /// <summary>Check if API is initialized.</summary>
        property bool IsInitialized {
            bool get() { return _initialized; }
        }

        /// <summary>Check if an instance is registered and active.</summary>
        property bool HasInstance {
            bool get() { return _instance != nullptr; }
        }

        /// <summary>Unregister and clean up the current instance.</summary>
        bool UnregisterInstance();

        /// <summary>Shut down the entire API.</summary>
        void Shutdown();
    };
}
