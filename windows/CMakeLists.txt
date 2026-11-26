# SPDX-FileCopyrightText: 2026 Muhannad Al-Ahmad
# SPDX-License-Identifier: GPL-2.0-or-later
cmake_minimum_required(VERSION 3.24)
project(MoonphaseWindows VERSION 1.0.0 LANGUAGES CXX)
if(NOT WIN32)
    message(FATAL_ERROR "This entry point builds the Windows host. Use the root Makefile for KDE.")
endif()
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 6.8 REQUIRED COMPONENTS Quick Widgets Network ShaderTools)
find_package(Python3 3.11 REQUIRED COMPONENTS Interpreter)
get_filename_component(SHARED_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
set(payload "${CMAKE_CURRENT_BINARY_DIR}/adapted")
file(GLOB_RECURSE shared_inputs CONFIGURE_DEPENDS
    "${SHARED_ROOT}/contents/ui/*.qml" "${SHARED_ROOT}/contents/code/*.js"
    "${SHARED_ROOT}/contents/config/*.xml" "${SHARED_ROOT}/contents/images/*")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/scripts/adapt.py" ${shared_inputs})
execute_process(COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/scripts/adapt.py"
    "${SHARED_ROOT}" "${payload}" COMMAND_ERROR_IS_FATAL ANY)
qt_add_executable(Moonphase WIN32 src/main.cpp src/desktop.cpp src/desktop.h src/app.cpp src/app.h src/app.rc)
target_compile_definitions(Moonphase PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(Moonphase PRIVATE Qt6::Quick Qt6::Widgets Qt6::Network user32 shell32 dwmapi wtsapi32)
file(GLOB_RECURSE resources "${payload}/*")
qt_add_resources(Moonphase "wallpaper" PREFIX "/wallpaper" BASE "${payload}" FILES ${resources})
file(GLOB shaders CONFIGURE_DEPENDS "${SHARED_ROOT}/contents/shaders/*.frag")
qt_add_shaders(Moonphase "shaders" PREFIX "/wallpaper/contents/shaders"
    BASE "${SHARED_ROOT}/contents/shaders" GLSL "100es,120,150" HLSL 50 MSL 12 FILES ${shaders})
install(TARGETS Moonphase RUNTIME DESTINATION .)
include(CTest)
find_program(NODE_EXECUTABLE NAMES node node.exe)
if(BUILD_TESTING AND NODE_EXECUTABLE)
    foreach(suite astronomy earth_orbit hijri prayer)
        add_test(NAME ${suite} COMMAND "${NODE_EXECUTABLE}" "${SHARED_ROOT}/tests/test_${suite}.mjs")
    endforeach()
    add_test(NAME windows_adapter COMMAND "${NODE_EXECUTABLE}"
        "${CMAKE_CURRENT_SOURCE_DIR}/tests/test_adapter.mjs" "${payload}")
endif()
